import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkLuaBundles } from "../../../tooling/lua-bundles.js";
import { CURSOR_FIXTURE_IDS, casesFor } from "./fixtures.js";
import { listCursorEndpoints, runCases } from "./harness.js";

// Safety net for shared Lua list-helper refactors. Every manifest query that
// takes `cursor` runs against its *generated bundle* (lua/endpoints/*.lua, generated;
// rebuild with `pnpm --filter @hypercerts-org/happyview-modules run build:lua`; edits to lua/shared or lua/src are
// invisible here until you rebuild) with a fake db. Captured SQL, binds and
// outcomes must match the committed golden byte for byte.
//
// Inputs per endpoint: paging/limit/cursor cases, every lexicon filter parameter
// (arrays with many/one/scalar/duplicate/empty values, booleans, scalars), a
// combined all-filters case, and table-driven rejection cases for bad
// sortDirection, limit and cursor shapes. `paged:*` cases return limit+1 rows
// so nextCursor encoding is captured; endpoints answer only their first query
// with rows, later hydration queries see none.
//
// To keep the file reviewable, each distinct SQL text is stored once in a
// leading `{"sql":id,"text":..}` line and calls refer to it by id.
// Regenerate after an intended behaviour change: UPDATE_GOLDEN=1 pnpm test:unit
// The golden runs generated bundles, so stale ones would pass or fail for the wrong reason.
const staleBundles = await checkLuaBundles(fileURLToPath(new URL("../../../", import.meta.url)));
if (staleBundles.length > 0) {
  throw new Error(
    `Generated Lua bundles are stale (${staleBundles.join(", ")}); run \`pnpm --filter @hypercerts-org/happyview-modules run build:lua\` before the list golden test.`,
  );
}

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
const actual = serialize(records);

/** One line per distinct SQL text (sorted by id), then one line per case. */
function serialize(cases) {
  const texts = new Map();
  const compact = cases.map((record) => ({
    ...record,
    // The runner encodes an empty Lua table as {}, so an empty call list is not an array.
    calls: (Array.isArray(record.calls) ? record.calls : []).map(({ sql, binds }) => {
      const id = createHash("sha1").update(sql).digest("hex").slice(0, 10);
      texts.set(id, sql);
      return { binds, sql: id };
    }),
  }));
  const sqlLines = [...texts]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([sql, text]) => ({ sql, text }));
  return `${[...sqlLines, ...compact].map((line) => JSON.stringify(line)).join("\n")}\n`;
}

if (process.env.UPDATE_GOLDEN === "1") writeFileSync(goldenPath, actual);

test("every cursor-taking manifest query has a cursor fixture", () => {
  const ids = endpoints.map((endpoint) => endpoint.id).sort();
  assert.deepEqual(
    ids,
    [...CURSOR_FIXTURE_IDS].sort(),
    "manifest query set and tests/unit/list-golden/fixtures.js CURSORS differ; add or remove the endpoint there",
  );
});

// Fixture guard, not a behavior test: the golden would happily record a rejected
// or empty case as "expected", silently pinning nothing. These fail loudly if a
// fixture stops reaching the code paths the golden is meant to cover.
test("fixtures reach real handler paths for every endpoint", () => {
  for (const endpoint of endpoints) {
    const mine = records.filter((r) => r.endpoint === endpoint.id);
    const validCursor = mine.find((r) => r.case.startsWith("cursor:valid:"));
    assert.ok(
      validCursor?.calls.length,
      `${endpoint.id}: fixture cursor was rejected before SQL (${JSON.stringify(validCursor?.outcome)}); fix cursorFor in fixtures.js`,
    );
    const paged = mine.find((r) => r.case.startsWith("paged:"));
    assert.ok(
      paged?.outcome.result?.cursor,
      `${endpoint.id}: paged case produced no nextCursor (${JSON.stringify(paged?.outcome).slice(0, 200)}); fix pageRow in fixtures.js`,
    );
    for (const filter of mine.filter((r) => r.case.startsWith("filter:"))) {
      assert.ok(
        filter.calls.length && !/^InvalidRequest/.test(filter.outcome.error ?? ""),
        `${endpoint.id} [${filter.case}]: filter fixture was rejected (${filter.outcome.error}); use a valid value in fixtures.js`,
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
      const source = JSON.parse(got[i] || want[i] || "null");
      changed.push(source?.case ? `${source.endpoint} [${source.case}]` : `sql line ${i + 1}`);
    }
  }
  changed.sort((a, b) => Number(a.startsWith("sql")) - Number(b.startsWith("sql")));
  assert.fail(
    `${changed.length} line(s) differ from list-endpoints.golden.jsonl: ${changed.slice(0, 10).join("; ")}. ` +
      "If intended, regenerate with UPDATE_GOLDEN=1 pnpm test:unit and review the diff.",
  );
});
