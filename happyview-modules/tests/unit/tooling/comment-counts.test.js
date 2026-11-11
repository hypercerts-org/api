import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const endpointPath = "lua/endpoints/getCommentCounts.lua";
const post = "at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/org.hypercerts.context.attachment/post";
const activity = "at://did:web:example.com/org.hypercerts.claim.activity/missing";

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
    if ${failure} then error('injected comment count failure') end
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

test("getCommentCounts counts every subject in one query and keeps request order", () => {
  runLua({
    params: { subjects: [post, activity, post] },
    rows: [{ subject: post, comment_count: "3" }],
    assertions: `
assert(#calls == 1, 'one statement must serve every subject')
local values = calls[1].values
assert(values[1] == 'org.hypercerts.context.attachment' and values[2] == 'comment')
assert(values[3] == '${post}' and values[4] == '${activity}' and #values == 4, 'duplicates are queried once')
assert(#result.counts == 3)
assert(result.counts[1].subject == '${post}' and result.counts[1].commentCount == 3)
assert(result.counts[2].subject == '${activity}' and result.counts[2].commentCount == 0)
assert(result.counts[3].subject == '${post}' and result.counts[3].commentCount == 3)
assert(math.type(result.counts[1].commentCount) == 'integer')
`,
  });
  runLua({
    params: { subjects: post },
    assertions: "assert(#result.counts == 1 and result.counts[1].commentCount == 0)",
  });
});

test("getCommentCounts rejects subjects that are not full record AT-URIs before querying", () => {
  const longPost = `at://did:plc:dddddddddddddddddddddddd/org.example.thing/${"k".repeat(500)}`;
  for (const subjects of [
    ["did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"],
    ["at://alice.example/org.hypercerts.context.attachment/post"],
    ["at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/invalid/key"],
    [`${post}?query`],
    ["at://did:web:example%GG/org.hypercerts.context.attachment/post"],
    Array(15).fill(longPost),
  ]) {
    runLua({ params: { subjects }, expectError: "InvalidRequest:", expectedCalls: 0 });
  }
});

test("getCommentCounts reports named errors for database and count failures", () => {
  runLua({
    params: { subjects: [post] },
    failure: true,
    expectError: "CommentCountQueryFailed:",
    expectedCalls: 1,
  });
  runLua({
    params: { subjects: [post] },
    backend: "sqlite",
    expectError: "CommentCountQueryFailed:",
    expectedCalls: 0,
  });
  for (const row of [{ subject: post, comment_count: "-1" }, { comment_count: "1" }]) {
    runLua({
      params: { subjects: [post] },
      rows: [row],
      expectError: "CommentCountQueryFailed:",
      expectedCalls: 1,
    });
  }
});
