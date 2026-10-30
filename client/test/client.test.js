// Loads the built package by its name, as a consumer would, and calls queries
// through an @atproto/lex Client with a stubbed fetch. No network access.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client } from "@atproto/lex";
import * as api from "@hypercerts-org/api";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const manifest = JSON.parse(
  await readFile(new URL("../../api/manifest.json", import.meta.url), "utf8"),
);

/**
 * @param {unknown} body
 * @param {URL[]} requests
 * @returns {typeof globalThis.fetch}
 */
function stubFetch(body, requests) {
  return async (input) => {
    requests.push(new URL(input instanceof Request ? input.url : String(input)));
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
}

test("LEXICON_VERSION matches the package metadata", () => {
  assert.equal(api.LEXICON_VERSION, packageJson.hypercerts.lexiconVersion);
});

test("every query Lexicon in api/manifest.json is exported by its short name", () => {
  const queryIds = manifest.validationLexicons
    .filter((/** @type {any} */ source) => source.path && !source.id.endsWith(".defs"))
    .map((/** @type {any} */ source) => source.id);
  assert.ok(queryIds.length > 0);
  for (const id of queryIds) {
    const name = id.split(".").at(-1);
    assert.equal(
      /** @type {any} */ (api)[name]?.nsid,
      id,
      `${name} should be the query definition for ${id}`,
    );
  }
});

test("a query sends its NSID and parameters and returns the validated body", async () => {
  /** @type {URL[]} */
  const requests = [];
  const client = new Client({
    service: "https://api.example",
    fetch: stubFetch({ badgeAwards: [] }, requests),
  });

  const body = await client.call(api.listBadgeAwards, { authors: ["did:plc:abc123"], limit: 5 });

  assert.deepEqual(body, { badgeAwards: [] });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.pathname, "/xrpc/app.certified.badge.listBadgeAwards");
  assert.deepEqual(requests[0]?.searchParams.getAll("authors"), ["did:plc:abc123"]);
  assert.equal(requests[0]?.searchParams.get("limit"), "5");
});

test("response validation rejects a body that does not match the Lexicon", async () => {
  const client = new Client({
    service: "https://api.example",
    fetch: stubFetch({ badgeAwards: "nope" }, []),
  });
  await assert.rejects(client.call(api.listBadgeAwards, {}));
});
