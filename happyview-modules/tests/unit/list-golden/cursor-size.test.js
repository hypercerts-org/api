import assert from "node:assert/strict";
import test from "node:test";
import { maximalCursorCase } from "./fixtures.js";
import { listCursorEndpoints, runCases } from "./harness.js";

// Every list endpoint shares one 8192-character cursor cap on decode. This proves
// the cap cannot reject a cursor the API itself issued: it builds the largest page
// cursor each endpoint can emit (longest DID and record key the handlers accept),
// checks it against the cap with the longest possible collection NSID instead of the
// endpoint's real one, and replays it as the next request.
const CURSOR_CAP = 8192;
const MAX_NSID_LENGTH = 317;

test("the largest cursor each list endpoint issues is below the decode cap and is accepted on replay", async () => {
  const endpoints = await listCursorEndpoints();
  let checked = 0;
  for (const endpoint of endpoints) {
    const big = maximalCursorCase(endpoint);
    if (!big) continue;
    const [issued] = runCases(endpoint.source, [big]);
    const cursor = issued.outcome.result?.cursor;
    assert.equal(
      typeof cursor,
      "string",
      `${endpoint.id}: no cursor issued (${JSON.stringify(issued.outcome).slice(0, 200)})`,
    );
    // The NSID appears once in the URI, so each extra character adds two hex characters.
    const worstCase = cursor.length + 2 * (MAX_NSID_LENGTH - big.collection.length);
    assert.ok(
      worstCase < CURSOR_CAP,
      `${endpoint.id}: worst-case cursor is ${worstCase} characters, cap is ${CURSOR_CAP}`,
    );

    const [replay] = runCases(endpoint.source, [
      { name: "replay", params: { ...big.params, cursor } },
    ]);
    // A later failure (e.g. a count query the fake db cannot answer) is fine; a cursor rejection is not.
    assert.doesNotMatch(
      replay.outcome.error ?? "",
      /^InvalidRequest/,
      `${endpoint.id}: own cursor rejected on replay: ${replay.outcome.error}`,
    );
    checked += 1;
  }
  assert.ok(checked >= 30, `only ${checked} endpoints checked`);
});
