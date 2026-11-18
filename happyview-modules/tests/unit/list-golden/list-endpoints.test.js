import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CURSOR_FIXTURE_IDS, casesFor, hasTimestampCursor } from "./fixtures.js";
import { listCursorEndpoints, runCases } from "./harness.js";

// Safety net for shared Lua list-helper refactors. Every manifest query that
// takes `cursor` runs against its generated bundle with a fake db; captured SQL,
// binds and outcomes must match the committed golden byte for byte.
// Regenerate after an intended behaviour change: UPDATE_GOLDEN=1 pnpm test:unit
const goldenPath = fileURLToPath(new URL("./list-endpoints.golden.jsonl", import.meta.url));

const endpoints = await listCursorEndpoints();
const records = endpoints.flatMap((endpoint) =>
  runCases(endpoint.source, casesFor(endpoint)).map(({ name, calls, outcome }) => ({
    endpoint: endpoint.id,
    case: name,
    calls,
    outcome,
  })),
);
const actual = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

if (process.env.UPDATE_GOLDEN === "1") writeFileSync(goldenPath, actual);

test("every cursor-taking manifest query has a cursor fixture", () => {
  const ids = endpoints.map((endpoint) => endpoint.id).sort();
  assert.deepEqual(
    ids,
    [...CURSOR_FIXTURE_IDS].sort(),
    "manifest query set and tests/unit/list-golden/fixtures.js CURSORS differ; add or remove the endpoint there",
  );
});

test("a valid cursor reaches SQL binds for every endpoint", () => {
  for (const endpoint of endpoints) {
    const record = records.find(
      (r) => r.endpoint === endpoint.id && r.case.startsWith("cursor:valid:"),
    );
    assert.ok(record, `${endpoint.id}: no valid-cursor case`);
    assert.ok(
      record.calls.length > 0,
      `${endpoint.id}: valid cursor did not reach SQL: ${JSON.stringify(record.outcome)}`,
    );
    if (hasTimestampCursor(endpoint)) {
      const binds = JSON.stringify(record.calls.map((call) => call.binds));
      assert.ok(
        binds.includes("2025-01-01T00:00:00"),
        `${endpoint.id}: cursor timestamp absent from binds`,
      );
    }
  }
});

test("list endpoint SQL, binds and outcomes match the golden snapshot", () => {
  const expected = readFileSync(goldenPath, "utf8");
  if (expected === actual) return;
  const want = expected.split("\n");
  const got = actual.split("\n");
  const changed = [];
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (want[i] !== got[i]) {
      const source = JSON.parse(got[i] ?? want[i] ?? "null");
      changed.push(source ? `${source.endpoint} [${source.case}]` : `line ${i + 1}`);
    }
  }
  assert.fail(
    `${changed.length} case(s) differ from list-endpoints.golden.jsonl: ${changed.slice(0, 10).join("; ")}. ` +
      "If intended, regenerate with UPDATE_GOLDEN=1 pnpm test:unit and review the diff.",
  );
});
