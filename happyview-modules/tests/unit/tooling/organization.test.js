import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lua } from "../helpers/lua.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const organizationCollection = "app.certified.actor.organization";
const profileCollection = "app.certified.actor.profile";
const locationCollection = "app.certified.location";
const actor = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const secondActor = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const thirdActor = "did:plc:cccccccccccccccccccccccc";
const fourthActor = "did:plc:dddddddddddddddddddddddd";
const indexedAt = "2025-01-02T03:04:05.000Z";
const resolverUrl = "https://resolver.example";

function miniDoc(did, handle) {
  return {
    status: 200,
    json: { did, handle, pds: "https://pds.example", signing_key: "zFixtureKey" },
  };
}

function organizationRow(did, id, record, sortTimestamp = "2025-01-01T00:00:00.000000Z") {
  return {
    uri: `at://${did}/${organizationCollection}/self`,
    did,
    cid: `bafy-${id}`,
    indexed_at: indexedAt,
    record: id,
    record_json: { $type: organizationCollection, ...record },
    sort_timestamp: sortTimestamp,
  };
}

function profileRow(did, id, record) {
  return {
    uri: `at://${did}/${profileCollection}/self`,
    did,
    cid: `bafy-${id}`,
    indexed_at: indexedAt,
    record: id,
    record_json: { $type: profileCollection, ...record },
  };
}

function locationRef(did, rkey, cid = "bafy-pinned") {
  return { uri: `at://${did}/${locationCollection}/${rkey}`, cid };
}

function locationRow(did, rkey, id, record, cid = `bafy-${id}`) {
  return {
    uri: `at://${did}/${locationCollection}/${rkey}`,
    did,
    cid,
    indexed_at: indexedAt,
    record: id,
    record_json: { $type: locationCollection, ...record },
  };
}

const pointLocation = {
  lpVersion: "1.0.0",
  srs: "https://www.opengis.net/def/crs/OGC/1.3/CRS84",
  locationType: "geojson-point",
  location: { $type: "app.certified.location#string", string: "POINT(89.64 27.47)" },
  createdAt: "2025-01-01T00:00:00Z",
};

function cursor({
  direction = "desc",
  timestamp = "2025-01-02T03:04:05.000000Z",
  uri = `at://${actor}/${organizationCollection}/self`,
} = {}) {
  return Buffer.from(JSON.stringify({ v: 1, d: direction, t: timestamp, u: uri }), "utf8").toString(
    "hex",
  );
}

function runLua({
  endpoint,
  params,
  queryResults = [],
  backend = "postgres",
  queryFailureAt = 0,
  resolverOrigin,
  httpReplies = [],
  expectError,
  expectedCalls = 0,
  expectedHttpCalls = 0,
  assertions,
}) {
  const endpointPath = `lua/endpoints/${endpoint}.lua`;
  assert.ok(
    existsSync(`${root}/${endpointPath}`),
    `${endpointPath} must be generated before exercising the handler`,
  );
  const records = Object.fromEntries(
    queryResults.flat().map((row) => [row.record, row.record_json]),
  );
  const rows = queryResults.map((resultSet) =>
    resultSet.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => key !== "record_json")),
    ),
  );
  const httpJson = Object.fromEntries(
    httpReplies
      .filter(({ json }) => json !== undefined)
      .map(({ json }) => [JSON.stringify(json), json]),
  );
  const responses = httpReplies.map(({ status, json, body, throws }) => ({
    status,
    body: json === undefined ? body : JSON.stringify(json),
    throws,
  }));
  const source = `
local RECORDS = ${lua(records)}
local RESULTS = ${lua(rows)}
local HTTP_JSON = ${lua(httpJson)}
local HTTP_RESPONSES = ${lua(responses)}
local NULL = {}
local calls, httpCalls = {}, {}
env = ${lua({ HYPERCERTS_HANDLE_RESOLVER_URL: resolverOrigin })}
http = { get = function(url)
  httpCalls[#httpCalls + 1] = url
  local response = HTTP_RESPONSES[#httpCalls]
  if not response or response.throws then error('fixture transport failure') end
  return response
end }
local function decode_cursor(value)
  local version = tonumber(value:match('"v":(%d+)'))
  local direction = value:match('"d":"([^"]*)"')
  local timestamp = value:match('"t":"([^"]*)"')
  local uri = value:match('"u":"([^"]*)"')
  if not version or not direction or not timestamp or not uri then error('invalid cursor JSON') end
  return { v = version, d = direction, t = timestamp, u = uri }
end
json = {
  decode = function(value)
    if value == 'null' then return NULL end
    if RECORDS[value] then return RECORDS[value] end
    if HTTP_JSON[value] then return HTTP_JSON[value] end
    if value:sub(1, 1) == '{' then return decode_cursor(value) end
    local decoded = value:gsub('..', function(pair) return string.char(tonumber(pair, 16)) end)
    return decode_cursor(decoded)
  end,
  encode = function(value)
    return string.format('{"v":%d,"d":"%s","t":"%s","u":"%s"}', value.v, value.d, value.t, value.u)
  end,
}
toarray = function(value) return value end
params = ${lua(params)}
db = {
  backend = function() return '${backend}' end,
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    if ${queryFailureAt || 0} == #calls then error('fixture database failure') end
    return RESULTS[#calls] or {}
  end,
}
dofile('${endpointPath}')
local ok, result = pcall(handle)
${
  expectError
    ? `assert(not ok, 'expected handler to reject the request')\nassert(tostring(result):find(${JSON.stringify(expectError)}, 1, true), tostring(result))\nassert(#calls == ${expectedCalls}, 'unexpected database query count')`
    : `assert(ok, tostring(result))\n${assertions}`
}
assert(#httpCalls == ${expectedHttpCalls}, 'unexpected resolver request count: ' .. #httpCalls)
`;
  const result = spawnSync("lua5.4", ["-e", source], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
}

test("organization module registers get, batch, list, and search queries with a local validation closure", async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  const modulePath = "modules/organization/manifest.json";
  assert.ok(manifest.modules.includes(modulePath));
  const module = JSON.parse(await readFile(`${root}/${modulePath}`, "utf8"));
  const queries = module.assets.filter(
    ({ kind, id }) => kind === "lexicon" && id.startsWith("app.certified.actor."),
  );
  assert.deepEqual(queries.map(({ id }) => id).sort(), [
    "app.certified.actor.getOrganization",
    "app.certified.actor.getOrganizations",
    "app.certified.actor.listOrganizations",
    "app.certified.actor.searchOrganizations",
  ]);
  for (const name of [
    "getOrganization",
    "getOrganizations",
    "listOrganizations",
    "searchOrganizations",
  ]) {
    const nsid = `app.certified.actor.${name}`;
    const script = module.assets.find(({ id }) => id === `xrpc.query:${nsid}`);
    assert.ok(script, `missing handler declaration for ${nsid}`);
    assert.equal(script.sourcePath, `../../lua/src/${name}.lua`);
    assert.ok(
      existsSync(`${root}/lua/endpoints/${name}.lua`),
      `missing generated handler for ${nsid}`,
    );
    assert.ok(
      manifest.validationLexicons.some(({ id }) => id === nsid),
      `missing validation Lexicon ${nsid}`,
    );
  }
});

test("organization Lexicons declare batch lookup results and separate list output actors from search filters", async () => {
  const getOrganization = JSON.parse(
    await readFile(`${root}/lexicons/app.certified.actor.getOrganization.json`, "utf8"),
  );
  const getOrganizations = JSON.parse(
    await readFile(`${root}/lexicons/app.certified.actor.getOrganizations.json`, "utf8"),
  );
  const listOrganizations = JSON.parse(
    await readFile(`${root}/lexicons/app.certified.actor.listOrganizations.json`, "utf8"),
  );
  const searchOrganizations = JSON.parse(
    await readFile(`${root}/lexicons/app.certified.actor.searchOrganizations.json`, "utf8"),
  );
  const getParams = getOrganization.defs.main.parameters;
  assert.deepEqual(getParams.required, ["actor"]);
  assert.equal(getParams.properties.actor.format, "did");

  const batchParameters = getOrganizations.defs.main.parameters;
  assert.deepEqual(batchParameters.required, ["actors"]);
  assert.deepEqual(Object.keys(batchParameters.properties), ["actors"]);
  assert.equal(batchParameters.properties.actors.minLength, 1);
  assert.equal(batchParameters.properties.actors.maxLength, 100);
  assert.equal(batchParameters.properties.actors.items.format, "did");
  const batchResult = getOrganizations.defs.organizationResult;
  assert.deepEqual(batchResult.required, ["actor", "organization"]);
  assert.deepEqual(batchResult.nullable, ["organization"]);
  assert.equal(
    getOrganizations.defs.output.properties.organizations.items.ref,
    "#organizationResult",
  );

  const expectedListingParams = [
    "cursor",
    "limit",
    "organizationTypes",
    "sortDirection",
    "visibility",
  ];
  assert.deepEqual(
    Object.keys(listOrganizations.defs.main.parameters.properties).sort(),
    expectedListingParams,
  );
  assert.equal(listOrganizations.defs.main.parameters.properties.actors, undefined);
  assert.deepEqual(
    Object.keys(searchOrganizations.defs.main.parameters.properties).sort(),
    [...expectedListingParams, "actors", "search"].sort(),
  );
  assert.deepEqual(searchOrganizations.defs.main.parameters.required, ["search"]);
  assert.equal(searchOrganizations.defs.main.parameters.properties.actors.maxLength, 100);
  for (const query of [listOrganizations, searchOrganizations]) {
    const properties = query.defs.main.parameters.properties;
    assert.equal(properties.organizationTypes.maxLength, 100);
    assert.equal(properties.sortDirection.enum.join(","), "asc,desc");
    assert.equal(properties.limit.minimum, 1);
    assert.equal(properties.limit.maximum, 100);
    assert.match(properties.limit.description, /default 25/i);
  }
});

test("getOrganization returns the complete sidecar and an explicit null when its profile is missing", () => {
  const organization = organizationRow(actor, "org", {
    organizationType: ["nonprofit"],
    createdAt: "2025-01-01T00:00:00Z",
  });
  runLua({
    endpoint: "getOrganization",
    params: { actor },
    queryResults: [[organization], []],
    resolverOrigin: resolverUrl,
    assertions: `
assert(result.actor.did == '${actor}' and result.actor.handle == nil)
assert(result.actor.profile == NULL)
assert(result.actor.organization.uri == '${organization.uri}' and result.actor.organization.cid == '${organization.cid}')
assert(result.actor.organization.indexedAt == '${indexedAt}' and result.actor.organization.did == '${actor}')
assert(result.actor.organization.record['$type'] == '${organizationCollection}')
assert(result.actor.organization.record.organizationType[1] == 'nonprofit')
assert(#calls == 2 and calls[1].values[1] == '${organizationCollection}' and calls[1].values[2] == '${actor}')
assert(calls[2].values[1] == '${profileCollection}' and calls[2].values[2] == '${actor}')
`,
  });
});

test("getOrganization preserves required indexedAt as null for organization and hydrated profile views", () => {
  const organization = organizationRow(actor, "unindexed", { organizationType: ["nonprofit"] });
  delete organization.indexed_at;
  const profile = profileRow(actor, "unindexed-profile", { displayName: "Unindexed profile" });
  delete profile.indexed_at;
  runLua({
    endpoint: "getOrganization",
    params: { actor },
    queryResults: [[organization], [profile]],
    assertions: `
assert(result.actor.organization.indexedAt == NULL, 'organization indexedAt must be explicit null')
assert(result.actor.organization.indexedAt ~= nil, 'organization indexedAt must be present')
assert(result.actor.profile.indexedAt == NULL, 'profile indexedAt must be explicit null')
assert(result.actor.profile.indexedAt ~= nil, 'profile indexedAt must be present')
assert(#calls == 2)
`,
  });
});

test("getOrganizations preserves requested occurrences and returns explicit null for missing sidecars", () => {
  const missingActor = "did:plc:cccccccccccccccccccccccc";
  const requested = [secondActor, missingActor, actor, secondActor];
  const firstOrganization = organizationRow(actor, "first", { organizationType: ["nonprofit"] });
  const secondOrganization = organizationRow(secondActor, "second", {
    organizationType: ["community"],
  });
  const profile = profileRow(actor, "first-profile", { displayName: "Forest Commons" });
  runLua({
    endpoint: "getOrganizations",
    params: { actors: requested },
    queryResults: [[firstOrganization, secondOrganization], [profile]],
    assertions: `
assert(#result.organizations == 4, 'one result per input occurrence')
assert(result.organizations[1].actor == '${secondActor}' and result.organizations[1].organization.did == '${secondActor}', 'first requested actor')
assert(result.organizations[1].organization.organization.uri == '${secondOrganization.uri}' and result.organizations[1].organization.organization.cid == '${secondOrganization.cid}', 'first sidecar identifiers')
assert(result.organizations[1].organization.organization.indexedAt == '${indexedAt}' and result.organizations[1].organization.organization.record['$type'] == '${organizationCollection}', 'first sidecar metadata and original record')
assert(result.organizations[1].organization.organization.record.organizationType[1] == 'community', 'first sidecar original fields')
assert(result.organizations[1].organization.profile == NULL, 'missing associated profile is null')
assert(result.organizations[2].actor == '${missingActor}' and result.organizations[2].organization == NULL, 'missing sidecar is null')
assert(result.organizations[2].organization ~= nil, 'missing sidecar must be explicit null')
assert(result.organizations[3].actor == '${actor}' and result.organizations[3].organization.did == '${actor}', 'third requested actor')
assert(result.organizations[3].organization.profile.record.displayName == 'Forest Commons', 'associated profile is hydrated')
assert(result.organizations[3].organization.organization.uri == '${firstOrganization.uri}', 'third sidecar')
assert(result.organizations[4].actor == '${secondActor}' and result.organizations[4].organization.organization.uri == '${secondOrganization.uri}', 'duplicate occurrence')
assert(result.cursor == nil, 'batch query does not paginate')
assert(#calls == 2 and calls[1].values[1] == '${organizationCollection}', 'one sidecar query and one profile hydration query')
assert(calls[1].values[2] == '${secondActor}' and calls[1].values[3] == '${missingActor}' and calls[1].values[4] == '${actor}', 'query uses unique DIDs in first-seen order')
assert(calls[2].values[1] == '${profileCollection}' and #calls[2].values == 3, 'profile hydration includes only present unique sidecars')
assert((calls[2].values[2] == '${secondActor}' and calls[2].values[3] == '${actor}') or (calls[2].values[2] == '${actor}' and calls[2].values[3] == '${secondActor}'))
`,
  });
});

test("getOrganizations validates 1..100 actor occurrences before querying", () => {
  for (const params of [
    {},
    { actors: [] },
    { actors: Array(101).fill(actor) },
    { actors: ["did:plc:abcd%"] },
    { actors: [actor], unknown: "value" },
  ]) {
    runLua({
      endpoint: "getOrganizations",
      params,
      expectError: "InvalidRequest:",
      expectedCalls: 0,
    });
  }

  const organization = organizationRow(actor, "boundary", {});
  const profile = profileRow(actor, "boundary-profile", {});
  runLua({
    endpoint: "getOrganizations",
    params: { actors: actor },
    queryResults: [[organization], [profile]],
    assertions: `assert(#result.organizations == 1 and result.organizations[1].actor == '${actor}')`,
  });
  runLua({
    endpoint: "getOrganizations",
    params: { actors: Array(100).fill(actor) },
    queryResults: [[organization], [profile]],
    assertions: `
assert(#result.organizations == 100)
assert(result.organizations[100].actor == '${actor}')
assert(#calls == 2 and #calls[1].values == 2 and #calls[2].values == 2)
`,
  });

  const broadDid = "did:plc:abcd%ZZ";
  runLua({
    endpoint: "getOrganizations",
    params: { actors: [broadDid] },
    queryResults: [[]],
    assertions: `
assert(#result.organizations == 1 and result.organizations[1].actor == '${broadDid}')
assert(result.organizations[1].organization == NULL)
assert(#calls == 1 and calls[1].values[2] == '${broadDid}')
`,
  });
});

test("listOrganizations rejects actors as a request filter", () => {
  runLua({
    endpoint: "listOrganizations",
    params: { actors: [actor] },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
});

test("listOrganizations sorts both tuple fields, filters before pagination, and hydrates only the returned page", () => {
  const first = organizationRow(actor, "first", {
    organizationType: ["nonprofit"],
    visibility: "unlisted",
    createdAt: "2025-01-01T00:00:00Z",
  });
  const lookahead = organizationRow(
    secondActor,
    "lookahead",
    { organizationType: ["community"], createdAt: "2025-01-02T00:00:00Z" },
    "2025-01-02T00:00:00.000000Z",
  );
  const profile = profileRow(actor, "profile", {
    displayName: "Forest Alliance",
    createdAt: "2025-01-01T00:00:00Z",
  });
  runLua({
    endpoint: "listOrganizations",
    params: {
      organizationTypes: ["nonprofit", "community", "nonprofit"],
      visibility: "unlisted",
      sortDirection: "asc",
      limit: "1",
    },
    queryResults: [[first, lookahead], [profile]],
    assertions: `
assert(#result.actors == 1 and result.actors[1].did == '${actor}')
assert(result.actors[1].profile.record.displayName == 'Forest Alliance')
assert(result.actors[1].organization.uri == '${first.uri}' and result.actors[1].organization.record.visibility == 'unlisted')
assert(calls[1].values[1] == '${organizationCollection}')
assert(calls[1].sql:find("organization.rkey = 'self'", 1, true))
assert(calls[1].sql:find('organizationType', 1, true) and calls[1].sql:find('visibility', 1, true))
assert(calls[1].sql:find("organization.record::jsonb->'createdAt'", 1, true))
assert(calls[1].sql:find('COALESCE(organization.indexed_at::timestamptz, organization.created_at::timestamptz)', 1, true))
assert(not calls[1].sql:find('organization.did IN', 1, true), 'list has no actor request filter')
assert(calls[1].sql:find('ORDER BY sorted.sort_at ASC, uri ASC', 1, true))
assert(calls[1].values[2] == 'nonprofit' and calls[1].values[3] == 'community' and calls[1].values[4] == 'unlisted')
assert(calls[1].values[#calls[1].values] == 2)
local cursorJson = result.cursor:gsub('..', function(pair) return string.char(tonumber(pair, 16)) end)
local token = json.decode(cursorJson)
assert(token.v == 1 and token.d == 'asc' and token.t == '${first.sort_timestamp}' and token.u == '${first.uri}')
assert(calls[2].values[1] == '${profileCollection}' and calls[2].values[2] == '${actor}')
assert(#calls == 2, 'the lookahead organization must not trigger profile hydration')
`,
  });
});

test("organization visibility omission includes unlisted and unspecified records and malformed dates use a safe sort fallback", () => {
  const unlisted = organizationRow(
    actor,
    "fallback",
    { visibility: "unlisted", createdAt: "not-a-date" },
    "2025-01-02T03:04:05.000000Z",
  );
  const unspecified = organizationRow(secondActor, "unspecified", {
    organizationType: ["community"],
    createdAt: "2025-01-01T00:00:00Z",
  });
  const profile = profileRow(actor, "fallback-profile", { displayName: "Unlisted group" });
  runLua({
    endpoint: "listOrganizations",
    params: {},
    queryResults: [[unlisted, unspecified], [profile]],
    assertions: `
assert(#result.actors == 2 and result.actors[1].organization.record.visibility == 'unlisted')
assert(result.actors[2].organization.record.visibility == nil and result.actors[2].profile == NULL)
assert(not calls[1].sql:find('visibility', 1, true))
assert(calls[1].sql:find('indexed_at', 1, true) and calls[1].sql:find('created_at', 1, true))
assert(calls[1].sql:find('ORDER BY sorted.sort_at DESC, uri DESC', 1, true))
assert(calls[1].values[2] == 26)
assert(#calls == 2 and calls[2].values[1] == '${profileCollection}' and calls[2].values[2] == '${actor}' and calls[2].values[3] == '${secondActor}')
`,
  });
});

test("searchOrganizations binds the complete trimmed literal and also matches legalName without requiring a profile", () => {
  const organization = organizationRow(actor, "search", {
    organizationType: ["nonprofit"],
    createdAt: "2025-01-01T00:00:00Z",
  });
  runLua({ endpoint: "searchOrganizations", params: {}, expectError: "InvalidRequest:" });
  runLua({
    endpoint: "searchOrganizations",
    params: {
      search: "  Forest %_ Restoration  ",
      actors: [actor],
      organizationTypes: ["nonprofit"],
    },
    queryResults: [
      [organization],
      [profileRow(actor, "search-profile", { displayName: "Forest %_ Restoration" })],
    ],
    assertions: `
assert(#result.actors == 1 and result.actors[1].did == '${actor}', 'actor result')
assert(calls[1].sql:find('strpos(lower', 1, true), 'literal substring SQL')
assert(calls[1].sql:find("organization.record::jsonb->>'legalName'", 1, true), 'legalName predicate')
assert(calls[1].sql:find(') > 0 OR EXISTS (SELECT 1', 1, true) and calls[1].sql:find('profile.did = organization.did', 1, true), 'profile alternative predicate')
assert(not calls[1].sql:find('Forest', 1, true), 'search text must be a bound SQL value')
assert(calls[1].sql:find('organization.did IN ($2)', 1, true), 'search retains its actors filter')
assert(calls[1].values[2] == '${actor}' and calls[1].values[3] == 'nonprofit' and calls[1].values[4] == 'Forest %_ Restoration', table.concat(calls[1].values, '|'))
assert(calls[1].values[5] == '${profileCollection}', table.concat(calls[1].values, '|'))
assert(calls[2].values[1] == '${profileCollection}' and calls[2].values[2] == '${actor}', 'profile hydration values')
`,
  });
  runLua({
    endpoint: "searchOrganizations",
    params: { search: "missing profile match" },
    queryResults: [[], []],
    assertions: `assert(#result.actors == 0 and #calls == 1, 'no-profile search matches must not hydrate results')`,
  });
});

test("organization listing cursors are direction-bound and use a strict keyset predicate", () => {
  const row = organizationRow(secondActor, "after", { createdAt: "2025-01-03T00:00:00Z" });
  runLua({
    endpoint: "listOrganizations",
    params: { sortDirection: "desc", cursor: cursor({ direction: "desc" }), limit: "1" },
    queryResults: [[row], []],
    assertions: `
assert(#result.actors == 1 and result.cursor == nil)
assert(calls[1].sql:find('(sorted.sort_at, uri) <', 1, true))
assert(calls[1].sql:find('ORDER BY sorted.sort_at DESC, uri DESC', 1, true))
assert(calls[1].values[2] == '2025-01-02T03:04:05.000000Z')
assert(calls[1].values[3] == 'at://${actor}/${organizationCollection}/self')
assert(calls[1].values[4] == 2)
`,
  });
  runLua({
    endpoint: "listOrganizations",
    params: { sortDirection: "asc", cursor: cursor({ direction: "desc" }) },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
});

test("organization filter occurrence limits apply before duplicate removal", () => {
  const organization = organizationRow(actor, "bounded-array", { organizationType: ["nonprofit"] });
  runLua({
    endpoint: "listOrganizations",
    params: { organizationTypes: Array(100).fill("nonprofit") },
    queryResults: [[organization], [profileRow(actor, "bounded-profile", {})]],
    assertions: `
assert(#result.actors == 1 and #calls == 2)
assert(not calls[1].sql:find('organization.did IN', 1, true))
assert(calls[1].values[1] == '${organizationCollection}' and calls[1].values[2] == 'nonprofit' and calls[1].values[3] == 26)
`,
  });
});

test("organization queries reject invalid and repeated scalar input before database access", () => {
  runLua({
    endpoint: "getOrganization",
    params: { actor: "alice.example" },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
  runLua({
    endpoint: "getOrganization",
    params: { actor: [actor, actor] },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
  runLua({
    endpoint: "listOrganizations",
    params: { unknown: "value" },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
  runLua({
    endpoint: "listOrganizations",
    params: { limit: ["1", "2"] },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
  runLua({
    endpoint: "listOrganizations",
    params: { organizationTypes: Array(101).fill("nonprofit") },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
  runLua({
    endpoint: "listOrganizations",
    params: { sortDirection: "sideways" },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
  runLua({
    endpoint: "listOrganizations",
    params: { limit: "0" },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
  runLua({
    endpoint: "listOrganizations",
    params: { limit: "101" },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
  runLua({
    endpoint: "listOrganizations",
    params: { foundedAfter: "2020-01-01T00:00:00Z" },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
  runLua({
    endpoint: "searchOrganizations",
    params: { search: ["forest", "group"] },
    expectError: "InvalidRequest:",
    expectedCalls: 0,
  });
});

test("organization misses and operational database failures remain distinct errors", () => {
  runLua({
    endpoint: "getOrganization",
    params: { actor },
    queryResults: [[]],
    expectError: "RecordNotFound:",
    expectedCalls: 1,
  });
  runLua({
    endpoint: "getOrganization",
    params: { actor },
    backend: "sqlite",
    expectError: "OrganizationQueryFailed:",
    expectedCalls: 0,
  });
  runLua({
    endpoint: "getOrganization",
    params: { actor },
    queryFailureAt: 1,
    expectError: "OrganizationQueryFailed:",
    expectedCalls: 1,
  });
  runLua({
    endpoint: "getOrganization",
    params: { actor },
    queryResults: [[organizationRow(actor, "hydration-error", {})]],
    queryFailureAt: 2,
    expectError: "OrganizationQueryFailed:",
    expectedCalls: 2,
  });
  runLua({
    endpoint: "listOrganizations",
    params: {},
    queryResults: [[organizationRow(actor, "list-error", {})]],
    queryFailureAt: 2,
    expectError: "OrganizationQueryFailed:",
    expectedCalls: 2,
  });
});

test("getOrganization returns the indexed location record its reference points to, unchanged", () => {
  const organization = organizationRow(actor, "with-location", {
    organizationType: ["nonprofit"],
    location: locationRef(actor, "3jzfcijpj2z2a", "bafy-location"),
  });
  const location = locationRow(actor, "3jzfcijpj2z2a", "location", pointLocation, "bafy-location");
  runLua({
    endpoint: "getOrganization",
    params: { actor },
    queryResults: [[organization], [], [location]],
    assertions: `
local primary = result.actor.location
assert(primary.uri == '${location.uri}' and primary.cid == 'bafy-location' and primary.did == '${actor}')
assert(primary.indexedAt == '${indexedAt}')
assert(primary.record['$type'] == '${locationCollection}' and primary.record.locationType == 'geojson-point')
assert(primary.record.location.string == 'POINT(89.64 27.47)')
assert(primary.author == nil, 'the location view carries no hydrated author')
assert(#calls == 3 and calls[3].values[1] == '${locationCollection}' and calls[3].values[2] == '${location.uri}' and #calls[3].values == 2)
assert(calls[3].sql:find('collection = $1 AND uri IN ($2)', 1, true))
`,
  });
});

test("organization views return an explicit null location without querying when the reference cannot name a location record", () => {
  const references = {
    absent: undefined,
    notAnObject: "at://x",
    missingUri: { cid: "bafy-pinned" },
    notAtUri: { uri: "https://example.com/location", cid: "bafy-pinned" },
    wrongCollection: {
      uri: `at://${actor}/org.hypercerts.claim.activity/3jzfcijpj2z2a`,
      cid: "bafy-pinned",
    },
    wrongCollectionPrefix: {
      uri: `at://${actor}/${locationCollection}.extra/3jzfcijpj2z2a`,
      cid: "bafy-pinned",
    },
  };
  for (const [name, reference] of Object.entries(references)) {
    const organization = organizationRow(actor, `ref-${name}`, {
      organizationType: ["nonprofit"],
      ...(reference === undefined ? {} : { location: reference }),
    });
    runLua({
      endpoint: "getOrganization",
      params: { actor },
      queryResults: [[organization], []],
      assertions: `
assert(result.actor.location == NULL, '${name}: location must be explicit null')
assert(result.actor.location ~= nil, '${name}: location must be present')
assert(#calls == 2, '${name}: no location query for a reference that cannot be a location record')
`,
    });
  }
});

test("location matches by URI and returns the latest indexed version when the pinned cid differs", () => {
  const organization = organizationRow(actor, "stale-location", {
    location: locationRef(actor, "3jzfcijpj2z2a", "bafy-pinned"),
  });
  const newer = locationRow(
    actor,
    "3jzfcijpj2z2a",
    "newer",
    { ...pointLocation, name: "Edited name" },
    "bafy-newer",
  );
  runLua({
    endpoint: "getOrganization",
    params: { actor },
    queryResults: [[organization], [], [newer]],
    assertions: `
assert(result.actor.location.cid == 'bafy-newer')
assert(result.actor.location.record.name == 'Edited name')
assert(result.actor.organization.record.location.cid == 'bafy-pinned')
assert(#calls[3].values == 2 and not calls[3].sql:find('cid =', 1, true), 'lookup must not filter by cid')
`,
  });
});

test("getOrganizations hydrates every location with one batched lookup over distinct URIs", () => {
  const sharedRkey = "3jzfcijpj2z2a";
  const first = organizationRow(actor, "batch-first", { location: locationRef(actor, sharedRkey) });
  const second = organizationRow(secondActor, "batch-second", {
    location: locationRef(actor, sharedRkey),
  });
  const third = organizationRow(thirdActor, "batch-third", {
    location: locationRef(thirdActor, "3jzfcijpj2z2b"),
  });
  const without = organizationRow(fourthActor, "batch-without", {});
  const shared = locationRow(actor, sharedRkey, "shared", pointLocation);
  const own = locationRow(thirdActor, "3jzfcijpj2z2b", "own", { ...pointLocation, name: "Own" });
  runLua({
    endpoint: "getOrganizations",
    params: { actors: [fourthActor, actor, secondActor, thirdActor, actor] },
    queryResults: [[first, second, third, without], [], [own, shared]],
    assertions: `
local function primary(index) return result.organizations[index].organization.location end
assert(primary(1) == NULL, 'organization without a location reference')
assert(primary(2).uri == '${shared.uri}', 'first organization')
assert(primary(3).uri == '${shared.uri}', 'second organization shares the location')
assert(primary(4).uri == '${own.uri}' and primary(4).record.name == 'Own', 'third organization')
assert(primary(5).uri == '${shared.uri}', 'repeated occurrence')
assert(#calls == 3, 'one organization, one profile and one location query')
assert(#calls[3].values == 3 and calls[3].values[1] == '${locationCollection}', 'distinct location URIs only')
assert(calls[3].sql:find('uri IN ($2, $3)', 1, true))
`,
  });
});

test("listOrganizations and searchOrganizations hydrate location for returned rows only", () => {
  const first = organizationRow(actor, "list-first", {
    location: locationRef(actor, "3jzfcijpj2z2a"),
  });
  const lookahead = organizationRow(secondActor, "list-lookahead", {
    location: locationRef(secondActor, "3jzfcijpj2z2b"),
  });
  const location = locationRow(actor, "3jzfcijpj2z2a", "list-location", pointLocation);
  runLua({
    endpoint: "listOrganizations",
    params: { limit: "1" },
    queryResults: [[first, lookahead], [], [location]],
    assertions: `
assert(#result.actors == 1 and result.actors[1].location.uri == '${location.uri}')
assert(#calls == 3 and #calls[3].values == 2, 'the lookahead row must not be hydrated')
assert(calls[3].values[2] == '${location.uri}')
`,
  });

  const withoutLocation = organizationRow(secondActor, "search-without", {});
  runLua({
    endpoint: "searchOrganizations",
    params: { search: "forest" },
    queryResults: [[first, withoutLocation], [], [location]],
    assertions: `
assert(#result.actors == 2)
assert(result.actors[1].location.uri == '${location.uri}')
assert(result.actors[2].location == NULL and result.actors[2].location ~= nil)
assert(#calls == 3)
`,
  });
});

test("a failed location lookup is reported as an organization query failure, not an empty location", () => {
  const organization = organizationRow(actor, "location-error", {
    location: locationRef(actor, "3jzfcijpj2z2a"),
  });
  runLua({
    endpoint: "getOrganization",
    params: { actor },
    queryResults: [[organization], []],
    queryFailureAt: 3,
    expectError: "OrganizationQueryFailed:",
    expectedCalls: 3,
  });
});

test("getActor returns a projection even when the DID has no indexed sidecars", () => {
  const did = "did:web:unknown.example%3A443";
  runLua({
    endpoint: "getActor",
    params: { actor: did },
    resolverOrigin: "http://resolver.example",
    assertions: `
assert(result.actor.did == '${did}')
assert(result.actor.profile == NULL and result.actor.organization == NULL and result.actor.location == NULL)
assert(result.actor.handle == nil)
assert(#calls == 2)
`,
  });
});

test("getActors keeps input order and duplicates while loading only distinct DIDs and primary location URIs", () => {
  const avatar = { $type: "blob", ref: { $link: "bafy-avatar" }, mimeType: "image/png", size: 42 };
  const profile = profileRow(actor, "actor-person", { avatar, displayName: "Person" });
  const primary = locationRef(secondActor, "3jzfcijpj2z2a");
  const additional = locationRef(secondActor, "3jzfcijpj2z2b");
  const missing = locationRef(thirdActor, "3jzfcijpj2z2c");
  const org = organizationRow(secondActor, "actor-org", {
    location: primary,
    additionalLocations: [additional],
  });
  const otherOrg = organizationRow(thirdActor, "actor-org-miss", { location: missing });
  const location = locationRow(secondActor, "3jzfcijpj2z2a", "actor-location", pointLocation);
  location.indexed_at = undefined;
  runLua({
    endpoint: "getActors",
    params: { actors: [secondActor, actor, thirdActor, fourthActor, secondActor] },
    queryResults: [[profile], [otherOrg, org], [location]],
    assertions: `
assert(#result.actors == 5)
local found, person, missing, unknown, repeated = table.unpack(result.actors)
assert(found.did == '${secondActor}' and repeated.did == found.did)
assert(person.did == '${actor}' and missing.did == '${thirdActor}' and unknown.did == '${fourthActor}')
assert(person.profile.uri == '${profile.uri}' and person.profile.cid == '${profile.cid}')
assert(person.profile.did == person.did and person.profile.indexedAt == '${indexedAt}')
assert(person.profile.record.avatar.ref['$link'] == 'bafy-avatar')
assert(person.organization == NULL and person.location == NULL)
assert(found.profile == NULL and found.organization.record.location.cid == '${primary.cid}')
assert(found.organization.record.additionalLocations[1].uri == '${additional.uri}')
assert(found.location.uri == '${primary.uri}' and found.location.cid == '${location.cid}')
assert(found.location.did == '${secondActor}' and found.location.indexedAt == NULL and found.location.author == nil)
assert(found.location.record.location.string == 'POINT(89.64 27.47)')
assert(repeated.location.uri == found.location.uri and repeated.organization.uri == found.organization.uri)
assert(missing.organization.uri == '${otherOrg.uri}' and missing.location == NULL)
assert(unknown.profile == NULL and unknown.organization == NULL and unknown.location == NULL)
for _, item in ipairs(result.actors) do assert(item.handle == nil) end
assert(#calls == 3)
for i, collection in ipairs({ '${profileCollection}', '${organizationCollection}' }) do
  assert(calls[i].values[1] == collection and #calls[i].values == 5)
  assert(calls[i].sql:find("rkey = 'self'", 1, true))
end
assert(calls[3].values[1] == '${locationCollection}' and #calls[3].values == 3)
assert(calls[3].values[2] == '${primary.uri}' and calls[3].values[3] == '${missing.uri}')
assert(not calls[3].sql:find('cid =', 1, true))
`,
  });
});

test("getActors accepts one bare occurrence or exactly 100 repeated occurrences", () => {
  for (const [actors, count] of [
    [actor, 1],
    [Array(100).fill(actor), 100],
  ]) {
    runLua({
      endpoint: "getActors",
      params: { actors },
      assertions: `
assert(#result.actors == ${count})
assert(result.actors[${count}].did == '${actor}')
assert(#calls == 2 and #calls[1].values == 2 and #calls[2].values == 2)
`,
    });
  }
});

test("actor lookups preserve opaque percent sequences in DIDs", () => {
  const did = "did:web:example%GG";
  for (const [endpoint, params, view] of [
    ["getActor", { actor: did }, "result.actor"],
    ["getActors", { actors: [actor, did] }, "result.actors[2]"],
  ]) {
    runLua({
      endpoint,
      params,
      resolverOrigin: "http://resolver.example",
      assertions: `assert(${view}.did == '${did}')`,
    });
  }
});

test("actor lookups reject invalid query occurrences before querying the index", () => {
  const invalidDid = "did:web:example%";
  for (const [endpoint, paramSets] of [
    [
      "getActor",
      [
        {},
        { actor: "example.com" },
        { actor: invalidDid },
        { actor: [actor, actor] },
        { actor, extra: "x" },
      ],
    ],
    [
      "getActors",
      [
        {},
        { actors: [] },
        { actors: [actor, invalidDid] },
        { actors: [actor, "example.com"] },
        { actors: [actor, 1] },
        { actors: Array(101).fill(actor) },
        { actors: { 2: actor } },
        { actors: actor, extra: "x" },
      ],
    ],
  ]) {
    for (const params of paramSets) {
      runLua({ endpoint, params, resolverOrigin: resolverUrl, expectError: "InvalidRequest:" });
    }
  }
});

test("actor lookups propagate sidecar and primary location query failures", () => {
  const org = organizationRow(actor, "actor-location-failure", {
    location: locationRef(actor, "3jzfcijpj2z2a"),
  });
  for (const queryFailureAt of [1, 2, 3]) {
    runLua({
      endpoint: "getActor",
      params: { actor },
      queryResults: [[], [org]],
      resolverOrigin: resolverUrl,
      queryFailureAt,
      expectError: "ActorQueryFailed:",
      expectedCalls: queryFailureAt,
    });
  }
});

test("getActor projects a matching Slingshot handle using the encoded DID", () => {
  const did = "did:web:actor.example%3A8443";
  runLua({
    endpoint: "getActor",
    params: { actor: did },
    resolverOrigin: `${resolverUrl}/`,
    httpReplies: [miniDoc(did, "Actor.Example")],
    expectedHttpCalls: 1,
    assertions: `
assert(httpCalls[1] == '${resolverUrl}/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=did%3Aweb%3Aactor.example%253A8443')
assert(result.actor.did == '${did}' and result.actor.handle == 'actor.example')
assert(result.actor.profile == NULL and result.actor.organization == NULL and result.actor.location == NULL)
assert(result.actor.pds == nil and result.actor.signing_key == nil)
`,
  });
});

test("getActor omits handles for resolver failures, malformed responses, and invalid handle claims", () => {
  for (const reply of [
    { throws: true },
    { status: 503, json: miniDoc(actor, "valid.example").json },
    { status: 200, body: "{" },
    { status: 200, json: "not an object" },
    miniDoc(secondActor, "valid.example"),
    miniDoc(actor, "Handle.Invalid"),
    miniDoc(actor, "bad_handle.example"),
    miniDoc(actor, "bad.123"),
    miniDoc(actor, "bad..example"),
    miniDoc(actor, null),
  ]) {
    runLua({
      endpoint: "getActor",
      params: { actor },
      resolverOrigin: resolverUrl,
      httpReplies: [reply],
      expectedHttpCalls: 1,
      assertions: `
assert(result.actor.did == '${actor}' and result.actor.handle == nil)
assert(result.actor.profile == NULL and result.actor.organization == NULL and result.actor.location == NULL)
`,
    });
  }
});

test("getActor uses the default Slingshot resolver when no origin is set", () => {
  runLua({
    endpoint: "getActor",
    params: { actor },
    httpReplies: [miniDoc(actor, "Actor.Example")],
    expectedHttpCalls: 1,
    assertions: `
assert(httpCalls[1]:find('https://slingshot.microcosm.blue/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier=', 1, true) == 1)
assert(result.actor.handle == 'actor.example')
`,
  });
});

test("getActor never contacts a resolver when its origin is invalid", () => {
  for (const resolverOrigin of [
    "http://resolver.example",
    "https://user@resolver.example",
    "https://resolver.example/path",
  ]) {
    runLua({
      endpoint: "getActor",
      params: { actor },
      resolverOrigin,
      assertions: "assert(result.actor.handle == nil)",
    });
  }
});

test("getActors makes no resolver calls and omits handles even when a resolver is configured", () => {
  const distinct = Array.from({ length: 3 }, (_, index) => `did:web:actor-${index}.example`);
  const requested = [distinct[0], distinct[0], distinct[1], distinct[2]];
  runLua({
    endpoint: "getActors",
    params: { actors: requested },
    resolverOrigin: resolverUrl,
    httpReplies: distinct.map((did) => miniDoc(did, "unexpected.example")),
    expectedHttpCalls: 0,
    assertions: `
local requested = ${lua(requested)}
assert(#result.actors == #requested)
for index, item in ipairs(result.actors) do
  assert(item.did == requested[index] and item.handle == nil)
end
`,
  });
});
