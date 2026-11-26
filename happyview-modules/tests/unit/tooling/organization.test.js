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
  tables = {},
  backend = "postgres",
  failOn,
  resolverOrigin,
  httpReplies = [],
  httpGlobal = "get",
  expectError,
  expectedCalls = failOn ? null : 0,
  expectedHttpCalls = 0,
  assertions,
}) {
  const endpointPath = `lua/endpoints/${endpoint}.lua`;
  assert.ok(
    existsSync(`${root}/${endpointPath}`),
    `${endpointPath} must be generated before exercising the handler`,
  );
  const records = Object.fromEntries(
    Object.values(tables)
      .flat()
      .map((row) => [row.record, row.record_json]),
  );
  const rows = Object.fromEntries(
    Object.entries(tables).map(([name, resultSet]) => [
      name,
      resultSet.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => key !== "record_json")),
      ),
    ]),
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
local TABLES = ${lua(rows)}
local TABLE_OF = { page = 'page', profile = 'profiles', organization = 'organizations', location = 'locations' }
local HTTP_JSON = ${lua(httpJson)}
local HTTP_RESPONSES = ${lua(responses)}
local NULL = {}
local calls, httpCalls = {}, {}
env = ${lua({ HYPERCERTS_HANDLE_RESOLVER_URL: resolverOrigin })}
local HTTP_GLOBAL = '${httpGlobal}'
http = { get = function(url)
  httpCalls[#httpCalls + 1] = url
  local response = HTTP_RESPONSES[#httpCalls]
  if not response or response.throws then error('fixture transport failure') end
  return response
end }
if HTTP_GLOBAL == 'absent' then http = nil elseif HTTP_GLOBAL == 'no-get' then http = {} end
local function same(a, b)
  if type(a) ~= 'table' or type(b) ~= 'table' then return a == b end
  for key, value in pairs(a) do if not same(value, b[key]) then return false end end
  for key in pairs(b) do if a[key] == nil then return false end end
  return true
end
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
    if value == '{' then error('fixture malformed JSON') end
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
  -- A fake index: each query is answered from the table it reads and, like
  -- the real WHERE clause, only returns rows for the DIDs/URIs it was given.
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    local kind = 'organization'
    if values[1] == '${profileCollection}' then kind = 'profile'
    elseif values[1] == '${locationCollection}' then kind = 'location'
    elseif sql:find('ORDER BY', 1, true) then kind = 'page' end
    if ${JSON.stringify(failOn ?? "")} == kind then error('fixture database failure') end
    local rows = TABLES[TABLE_OF[kind]] or {}
    if kind == 'page' then return rows end
    local wanted = {}
    for index = 2, #values do wanted[values[index]] = true end
    local matched = {}
    for _, row in ipairs(rows) do
      if wanted[kind == 'location' and row.uri or row.did] then matched[#matched + 1] = row end
    end
    return matched
  end,
}
dofile('${endpointPath}')
local ok, result = pcall(handle)
${
  expectError
    ? `assert(not ok, 'expected handler to reject the request')\nassert(tostring(result):find(${JSON.stringify(expectError)}, 1, true), tostring(result))\n${expectedCalls === null ? "" : `assert(#calls == ${expectedCalls}, 'unexpected database query count')`}`
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
    tables: { organizations: [organization] },
    resolverOrigin: resolverUrl,
    assertions: `
assert(result.actor.did == '${actor}' and result.actor.handle == nil)
assert(result.actor.profile == NULL)
assert(result.actor.organization.uri == '${organization.uri}' and result.actor.organization.cid == '${organization.cid}')
assert(result.actor.organization.indexedAt == '${indexedAt}' and result.actor.organization.did == '${actor}')
assert(result.actor.organization.record['$type'] == '${organizationCollection}')
assert(result.actor.organization.record.organizationType[1] == 'nonprofit')
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
    tables: { organizations: [organization], profiles: [profile] },
    assertions: `
assert(result.actor.organization.indexedAt == NULL, 'organization indexedAt must be explicit null')
assert(result.actor.organization.indexedAt ~= nil, 'organization indexedAt must be present')
assert(result.actor.profile.indexedAt == NULL, 'profile indexedAt must be explicit null')
assert(result.actor.profile.indexedAt ~= nil, 'profile indexedAt must be present')
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
    tables: { organizations: [firstOrganization, secondOrganization], profiles: [profile] },
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
    tables: { organizations: [organization], profiles: [profile] },
    assertions: `assert(#result.organizations == 1 and result.organizations[1].actor == '${actor}')`,
  });
  runLua({
    endpoint: "getOrganizations",
    params: { actors: Array(100).fill(actor) },
    tables: { organizations: [organization], profiles: [profile] },
    assertions: `
assert(#result.organizations == 100)
assert(result.organizations[100].actor == '${actor}')
assert(#calls[1].values == 2, 'duplicate occurrences are looked up once')
`,
  });

  const broadDid = "did:plc:abcd%ZZ";
  runLua({
    endpoint: "getOrganizations",
    params: { actors: [broadDid] },
    assertions: `
assert(#result.organizations == 1 and result.organizations[1].actor == '${broadDid}')
assert(result.organizations[1].organization == NULL)
assert(calls[1].values[2] == '${broadDid}', 'the DID is bound verbatim')
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
    tables: { page: [first, lookahead], organizations: [first, lookahead], profiles: [profile] },
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
for _, call in ipairs(calls) do
  for _, value in ipairs(call.values) do assert(value ~= '${secondActor}', 'the lookahead organization must not be hydrated') end
end
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
    tables: {
      page: [unlisted, unspecified],
      organizations: [unlisted, unspecified],
      profiles: [profile],
    },
    assertions: `
assert(#result.actors == 2 and result.actors[1].organization.record.visibility == 'unlisted')
assert(result.actors[2].organization.record.visibility == nil and result.actors[2].profile == NULL)
assert(not calls[1].sql:find('visibility', 1, true))
assert(calls[1].sql:find('indexed_at', 1, true) and calls[1].sql:find('created_at', 1, true))
assert(calls[1].sql:find('ORDER BY sorted.sort_at DESC, uri DESC', 1, true))
assert(calls[1].values[2] == 26)
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
    tables: {
      page: [organization],
      organizations: [organization],
      profiles: [profileRow(actor, "search-profile", { displayName: "Forest %_ Restoration" })],
    },
    assertions: `
assert(#result.actors == 1 and result.actors[1].did == '${actor}', 'actor result')
assert(calls[1].sql:find('strpos(lower', 1, true), 'literal substring SQL')
assert(calls[1].sql:find("organization.record::jsonb->>'legalName'", 1, true), 'legalName predicate')
assert(calls[1].sql:find(') > 0 OR EXISTS (SELECT 1', 1, true) and calls[1].sql:find('profile.did = organization.did', 1, true), 'profile alternative predicate')
assert(not calls[1].sql:find('Forest', 1, true), 'search text must be a bound SQL value')
assert(calls[1].sql:find('organization.did IN ($2)', 1, true), 'search retains its actors filter')
assert(calls[1].values[2] == '${actor}' and calls[1].values[3] == 'nonprofit' and calls[1].values[4] == 'Forest %_ Restoration', table.concat(calls[1].values, '|'))
assert(calls[1].values[5] == '${profileCollection}', table.concat(calls[1].values, '|'))
assert(result.actors[1].profile.record.displayName == 'Forest %_ Restoration', 'profile hydrated')
`,
  });
  runLua({
    endpoint: "searchOrganizations",
    params: { search: "missing profile match" },
    assertions: `assert(#result.actors == 0 and #calls == 1, 'no-profile search matches must not hydrate results')`,
  });
});

test("organization listing cursors are direction-bound and use a strict keyset predicate", () => {
  const row = organizationRow(secondActor, "after", { createdAt: "2025-01-03T00:00:00Z" });
  runLua({
    endpoint: "listOrganizations",
    params: { sortDirection: "desc", cursor: cursor({ direction: "desc" }), limit: "1" },
    tables: { page: [row], organizations: [row] },
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
    tables: {
      page: [organization],
      organizations: [organization],
      profiles: [profileRow(actor, "bounded-profile", {})],
    },
    assertions: `
assert(#result.actors == 1)
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
    tables: { profiles: [profileRow(actor, "profile-only", { displayName: "No sidecar" })] },
    expectError: "RecordNotFound:",
    expectedCalls: null,
  });
  runLua({
    endpoint: "getOrganization",
    params: { actor },
    backend: "sqlite",
    expectError: "OrganizationQueryFailed:",
    expectedCalls: 0,
  });
  for (const failOn of ["profile", "organization"]) {
    runLua({
      endpoint: "getOrganization",
      params: { actor },
      failOn,
      expectError: "OrganizationQueryFailed:",
    });
  }
  runLua({
    endpoint: "listOrganizations",
    params: {},
    failOn: "page",
    expectError: "OrganizationQueryFailed:",
  });
  runLua({
    endpoint: "listOrganizations",
    params: {},
    tables: { page: [organizationRow(actor, "list-error", {})] },
    failOn: "profile",
    expectError: "OrganizationQueryFailed:",
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
    tables: { organizations: [organization], locations: [location] },
    assertions: `
local primary = result.actor.location
assert(primary.uri == '${location.uri}' and primary.cid == 'bafy-location' and primary.did == '${actor}')
assert(primary.indexedAt == '${indexedAt}')
assert(primary.record['$type'] == '${locationCollection}' and primary.record.locationType == 'geojson-point')
assert(primary.record.location.string == 'POINT(89.64 27.47)')
assert(primary.author == nil, 'the location view carries no hydrated author')
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
      tables: { organizations: [organization] },
      assertions: `
assert(result.actor.location == NULL, '${name}: location must be explicit null')
assert(result.actor.location ~= nil, '${name}: location must be present')
for _, call in ipairs(calls) do
  assert(call.values[1] ~= '${locationCollection}', '${name}: no location query for a reference that cannot be a location record')
end
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
    tables: { organizations: [organization], locations: [newer] },
    assertions: `
assert(result.actor.location.cid == 'bafy-newer')
assert(result.actor.location.record.name == 'Edited name')
assert(result.actor.organization.record.location.cid == 'bafy-pinned')
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
    tables: { organizations: [first, second, third, without], locations: [own, shared] },
    assertions: `
local function primary(index) return result.organizations[index].organization.location end
assert(primary(1) == NULL, 'organization without a location reference')
assert(primary(2).uri == '${shared.uri}', 'first organization')
assert(primary(3).uri == '${shared.uri}', 'second organization shares the location')
assert(primary(4).uri == '${own.uri}' and primary(4).record.name == 'Own', 'third organization')
assert(primary(5).uri == '${shared.uri}', 'repeated occurrence')
local locationCalls = 0
for _, call in ipairs(calls) do
  if call.values[1] == '${locationCollection}' then locationCalls = locationCalls + 1 end
end
assert(locationCalls == 1, 'one batched location lookup')
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
    tables: {
      page: [first, lookahead],
      organizations: [first, lookahead],
      locations: [
        location,
        locationRow(secondActor, "3jzfcijpj2z2b", "lookahead-location", pointLocation),
      ],
    },
    assertions: `
assert(#result.actors == 1 and result.actors[1].location.uri == '${location.uri}')
for _, call in ipairs(calls) do
  for _, value in ipairs(call.values) do assert(not tostring(value):find('3jzfcijpj2z2b', 1, true), 'the lookahead row must not be hydrated') end
end
`,
  });

  const withoutLocation = organizationRow(secondActor, "search-without", {});
  runLua({
    endpoint: "searchOrganizations",
    params: { search: "forest" },
    tables: {
      page: [first, withoutLocation],
      organizations: [first, withoutLocation],
      locations: [location],
    },
    assertions: `
assert(#result.actors == 2)
assert(result.actors[1].location.uri == '${location.uri}')
assert(result.actors[2].location == NULL and result.actors[2].location ~= nil)
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
    tables: { organizations: [organization] },
    failOn: "location",
    expectError: "OrganizationQueryFailed:",
  });
});

test("getActor returns a projection even when the DID has no indexed sidecars", () => {
  const did = "did:web:unknown.example%3A443";
  runLua({
    endpoint: "getActor",
    params: { actor: did },
    httpReplies: [{ throws: true }],
    expectedHttpCalls: 1,
    assertions: `
assert(result.actor.did == '${did}')
assert(result.actor.profile == NULL and result.actor.organization == NULL and result.actor.location == NULL)
assert(result.actor.handle == nil)
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
    tables: { profiles: [profile], organizations: [otherOrg, org], locations: [location] },
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
local bound = 0
for _, call in ipairs(calls) do
  if call.values[1] == '${profileCollection}' or call.values[1] == '${organizationCollection}' then
    assert(#call.values == 5, 'each DID is bound once')
    bound = bound + 1
  end
end
assert(bound == 2)
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
assert(#calls[1].values == 2, 'repeated occurrences are looked up once')
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
  for (const failOn of ["profile", "organization", "location"]) {
    runLua({
      endpoint: "getActor",
      params: { actor },
      tables: { organizations: [org] },
      resolverOrigin: resolverUrl,
      failOn,
      expectError: "ActorQueryFailed:",
    });
  }
});

test("getActor projects a matching Slingshot handle using the encoded DID, defaulting to Slingshot when no origin is set", () => {
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

test("getActor still answers without a handle and never contacts a resolver whose origin is unsafe", () => {
  runLua({
    endpoint: "getActor",
    params: { actor },
    resolverOrigin: "http://resolver.example",
    assertions: "assert(result.actor.handle == nil)",
  });
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

test("organization batch, list and search never resolve handles even when a resolver is configured", () => {
  const organization = organizationRow(actor, "no-handle", { organizationType: ["nonprofit"] });
  for (const [endpoint, params, view] of [
    ["getOrganizations", { actors: [actor] }, "result.organizations[1].organization"],
    ["listOrganizations", {}, "result.actors[1]"],
    ["searchOrganizations", { search: "forest" }, "result.actors[1]"],
  ]) {
    runLua({
      endpoint,
      params,
      tables: { page: [organization], organizations: [organization] },
      resolverOrigin: resolverUrl,
      httpReplies: [miniDoc(actor, "unexpected.example")],
      expectedHttpCalls: 0,
      assertions: `assert(${view}.did == '${actor}' and ${view}.handle == nil)`,
    });
  }
});

test("getOrganization and getOrganizations return the same view per DID as getActors", () => {
  const withLocation = organizationRow(actor, "parity-org", {
    organizationType: ["nonprofit"],
    location: locationRef(actor, "3jzfcijpj2z2a"),
  });
  const withoutProfile = organizationRow(secondActor, "parity-bare", {});
  const profileOnly = profileRow(thirdActor, "parity-profile-only", { displayName: "Person" });
  const profiles = [profileRow(actor, "parity-profile", { displayName: "Forest" }), profileOnly];
  const locations = [locationRow(actor, "3jzfcijpj2z2a", "parity-location", pointLocation)];
  const requested = [secondActor, thirdActor, fourthActor, actor, secondActor];
  runLua({
    endpoint: "getActors",
    params: { actors: requested },
    tables: { organizations: [withLocation, withoutProfile], profiles, locations },
    assertions: `
local actorViews = result.actors
local function view_of(did)
  for _, item in ipairs(actorViews) do if item.did == did then return item end end
end
dofile('lua/endpoints/getOrganizations.lua')
local batch = handle()
assert(#batch.organizations == ${requested.length})
for index, did in ipairs(${lua(requested)}) do
  local entry = batch.organizations[index]
  assert(entry.actor == did)
  local expected = view_of(did)
  if expected.organization == NULL then
    assert(entry.organization == NULL, did .. ': no organization sidecar must be null')
  else
    assert(same(entry.organization, expected), did .. ': batch view differs from getActors')
  end
end
params = { actor = '${actor}' }
dofile('lua/endpoints/getOrganization.lua')
assert(same(handle().actor, view_of('${actor}')), 'getOrganization view differs from getActors')
`,
  });
});

test("a resolver origin is accepted by scheme and authority alone, without IP or DNS syntax checks", () => {
  runLua({
    endpoint: "getActor",
    params: { actor },
    resolverOrigin: "https://999.999.999.999",
    httpReplies: [miniDoc(actor, "ip.example")],
    expectedHttpCalls: 1,
    assertions: `
assert(httpCalls[1]:find('https://999.999.999.999/xrpc/', 1, true) == 1)
assert(result.actor.handle == 'ip.example')
`,
  });
});

test("getActor omits the handle when the HTTP client is missing or has no get function", () => {
  for (const httpGlobal of ["absent", "no-get"]) {
    runLua({
      endpoint: "getActor",
      params: { actor },
      resolverOrigin: resolverUrl,
      httpGlobal,
      assertions: `assert(result.actor.did == '${actor}' and result.actor.handle == nil)`,
    });
  }
});
