import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validatePackageLexicons } from "../../../tooling/validate-lexicons.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const endpointPath = "lua/endpoints/getFollowerCounts.lua";
const follow = "app.certified.graph.follow";
const entityFollow = "app.certified.graph.entityFollow";
const account = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const otherAccount = "did:web:example.com";
const entity = "at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/org.hypercerts.collection/project";
const missingEntity = "at://did:plc:cccccccccccccccccccccccc/org.hypercerts.claim.activity/missing";

function lua(value) {
  if (value === null) return "nil";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `{${value.map(lua).join(",")}}`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, item]) => `[${JSON.stringify(key)}]=${lua(item)}`)
      .join(",")}}`;
  }
  throw new TypeError(`Cannot encode ${typeof value} as a Lua fixture`);
}

function runLua({
  params,
  rows = [],
  failure = false,
  backend = "postgres",
  expectError,
  expectedCalls,
  assertions,
}) {
  assert.ok(existsSync(path.join(root, endpointPath)), `${endpointPath} must be generated first`);
  const source = `
local rows = ${lua(rows)}
local calls = {}
toarray = function(value) return value end
json = { decode = function() error('unexpected JSON decode') end }
params = ${lua(params)}
db = {
  backend = function() return '${backend}' end,
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    if ${failure} then error('injected follower count failure') end
    return rows
  end,
}
dofile('${endpointPath}')
local ok, result = pcall(handle)
${
  expectError
    ? `assert(not ok, 'expected handler to reject the request')
assert(tostring(result):find('${expectError}', 1, true), tostring(result))
assert(#calls == ${expectedCalls ?? 0}, 'unexpected PostgreSQL query count: ' .. #calls)`
    : `assert(ok, tostring(result))\n${assertions ?? ""}`
}
`;
  const result = spawnSync("lua5.4", ["-e", source], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
}

test("getFollowerCounts counts mixed DIDs and entity URIs in one statement, in request order", () => {
  runLua({
    params: { subjects: [account, entity, missingEntity, account, otherAccount] },
    rows: [
      { subject: account, follower_count: "3" },
      { subject: entity, follower_count: "2" },
    ],
    assertions: `
assert(#calls == 1, 'one statement must serve every subject')
local values = calls[1].values
assert(values[1] == '${follow}' and values[2] == '${account}' and values[3] == '${otherAccount}')
assert(values[4] == '${entityFollow}' and values[5] == '${entity}' and values[6] == '${missingEntity}')
assert(#values == 6, 'duplicate subjects are queried once')
assert(#result.counts == 5)
local expected = {
  { '${account}', 3 }, { '${entity}', 2 }, { '${missingEntity}', 0 }, { '${account}', 3 }, { '${otherAccount}', 0 },
}
for index, pair in ipairs(expected) do
  assert(result.counts[index].subject == pair[1] and result.counts[index].followerCount == pair[2], 'entry ' .. index)
  assert(math.type(result.counts[index].followerCount) == 'integer')
end
`,
  });
});

test("getFollowerCounts queries only the collection a single-kind batch needs", () => {
  runLua({
    params: { subjects: [account] },
    assertions: `
assert(#calls == 1 and not calls[1].sql:find('UNION', 1, true))
assert(calls[1].values[1] == '${follow}' and #calls[1].values == 2)
assert(result.counts[1].followerCount == 0)
`,
  });
  runLua({
    params: { subjects: entity },
    assertions: `
assert(#calls == 1 and not calls[1].sql:find('UNION', 1, true))
assert(calls[1].values[1] == '${entityFollow}' and calls[1].values[2] == '${entity}')
`,
  });
});

test("getFollowerCounts accepts 100 subjects and rejects invalid batches before querying", () => {
  runLua({
    params: { subjects: Array(100).fill(account) },
    assertions: "assert(#result.counts == 100 and #calls == 1)",
  });

  const longEntity = `at://did:plc:dddddddddddddddddddddddd/org.example.thing/${"k".repeat(500)}`;
  // Batch-shape errors (missing, empty, over 100, unknown keys) are covered by the
  // shared follow_batch_targets tests; these cases are specific to subject classification.
  for (const params of [
    { subjects: ["alice.example"] },
    { subjects: ["did:plc:"] },
    { subjects: ["at://alice.example/org.hypercerts.collection/project"] },
    { subjects: ["at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/invalid/key"] },
    { subjects: [`${entity}?query`] },
    { subjects: Array(15).fill(longEntity) },
  ]) {
    runLua({ params, expectError: "InvalidRequest:", expectedCalls: 0 });
  }
});

test("getFollowerCounts reports named errors for database and count failures", () => {
  runLua({
    params: { subjects: [account] },
    failure: true,
    expectError: "FollowerCountQueryFailed:",
    expectedCalls: 1,
  });
  runLua({
    params: { subjects: [account] },
    backend: "sqlite",
    expectError: "FollowerCountQueryFailed:",
    expectedCalls: 0,
  });
  for (const row of [
    { subject: account, follower_count: "-1" },
    { subject: account, follower_count: "1.5" },
    { follower_count: "1" },
  ]) {
    runLua({
      params: { subjects: [account] },
      rows: [row],
      expectError: "FollowerCountQueryFailed:",
      expectedCalls: 1,
    });
  }
});

test("getFollowerCounts Lexicon accepts DIDs and AT-URIs in one subjects list", async () => {
  const { lexicons } = await validatePackageLexicons();
  const main = lexicons.getDefOrThrow("app.certified.graph.getFollowerCounts");
  // DIDs and AT-URIs share one list, so items use the generic uri format.
  assert.equal(main.parameters.properties.subjects.items.format, "uri");
  assert.equal(main.parameters.properties.subjects.maxLength, 100);
});
