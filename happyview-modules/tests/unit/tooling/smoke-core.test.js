import assert from "node:assert/strict";
import test from "node:test";
import { genericInvariants, installedQueryIds } from "../../../tooling/smoke.js";
import { SMOKE_CASES } from "../../../tooling/smoke-cases.js";
import {
  assertReadOnlyRequest,
  createHttpClient,
  findCoverageGaps,
  normalizeBaseUrl,
  runPool,
} from "../../../tooling/smoke-core.js";

const response = (status, body = {}) => new Response(JSON.stringify(body), { status });

/** Client over a scripted fetch; returns the calls it saw. */
function scripted(...replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { calls, client: createHttpClient({ baseUrl: "https://api.example/", fetchImpl }) };
}

test("only GET requests to /xrpc/ are allowed", () => {
  assert.doesNotThrow(() => assertReadOnlyRequest("GET", "https://x.test/xrpc/a.b.c"));
  assert.throws(() => assertReadOnlyRequest("POST", "https://x.test/xrpc/a.b.c"), /only send GET/);
  assert.throws(() => assertReadOnlyRequest("GET", "https://x.test/admin/lexicons"), /\/xrpc\//);
});

test("base URL rejects credentials and non-http schemes", () => {
  assert.equal(normalizeBaseUrl("https://api.example/"), "https://api.example");
  assert.throws(() => normalizeBaseUrl("https://u:p@api.example"), /credentials/);
  assert.throws(() => normalizeBaseUrl("ftp://api.example"), /http/);
  assert.throws(() => normalizeBaseUrl("not a url"), /Invalid API base URL/);
});

test("retries once on 5xx and returns the second result", async () => {
  const { client, calls } = scripted(response(503), response(200, { ok: 1 }));
  const res = await client.get("a.b.c", { x: ["1", "2"] });
  assert.equal(res.status, 200);
  assert.equal(res.attempts, 2);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["GET", "GET"],
  );
  assert.equal(calls[0]?.url, "https://api.example/xrpc/a.b.c?x=1&x=2");
});

test("retries once on a network failure, then reports status 0", async () => {
  const { client, calls } = scripted(new Error("reset"), new Error("reset"));
  const res = await client.get("a.b.c");
  assert.equal(res.status, 0);
  assert.equal(res.attempts, 2);
  assert.equal(calls.length, 2);
});

test("never retries a 4xx", async () => {
  const { client, calls } = scripted(response(400, { error: "InvalidRequest" }));
  const res = await client.get("a.b.c");
  assert.equal(res.attempts, 1);
  assert.equal(calls.length, 1);
});

test("coverage guard reports missing and stale cases", () => {
  assert.deepEqual(findCoverageGaps(["a", "b"], ["b", "c"]), { missing: ["a"], stale: ["c"] });
  assert.deepEqual(findCoverageGaps(["a"], ["a"]), { missing: [], stale: [] });
});

test("runPool never exceeds the concurrency limit and keeps order", async () => {
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 10 }, (_, i) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return i;
  });
  assert.deepEqual(await runPool(tasks, 3), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(peak <= 3);
});

test("generic invariants flag oversized pages, small totals, reordered counts and uri mismatch", () => {
  assert.deepEqual(genericInvariants({ items: [1, 2], totalCount: 2 }, { limit: 5 }), []);
  assert.match(genericInvariants({ items: [1, 2, 3] }, { limit: 2 })[0] ?? "", /more than limit/);
  assert.match(genericInvariants({ items: [1, 2], totalCount: 1 }, {})[0] ?? "", /totalCount/);
  assert.match(
    genericInvariants(
      { counts: [{ subject: "b" }, { subject: "a" }] },
      { subjects: ["a", "b"] },
    )[0] ?? "",
    /request order/,
  );
  assert.match(genericInvariants({ record: { uri: "x" } }, { uri: "y" })[0] ?? "", /echo/);
});

test("every installed query has a smoke case (adding a query lexicon requires one)", async () => {
  const gaps = findCoverageGaps(await installedQueryIds(), Object.keys(SMOKE_CASES));
  assert.deepEqual(gaps, { missing: [], stale: [] });
});
