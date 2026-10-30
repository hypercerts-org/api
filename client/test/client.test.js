// Loads the built package by its name, as a consumer would, and calls queries
// through an @atproto/lex Client with a stubbed fetch. No network access.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, XrpcResponseValidationError } from "@atproto/lex";
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

/**
 * Follows an NSID through lex's namespace tree: org.hypercerts.claim.getActivity.
 * @param {object} root
 * @param {string} nsid
 * @returns {any}
 */
const lookup = (root, nsid) =>
  nsid.split(".").reduce((node, part) => /** @type {any} */ (node)?.[part], root);

test("every Lexicon in api/manifest.json is at its NSID path", async () => {
  const records = await import("@hypercerts-org/lexicon/records");
  const sources = manifest.validationLexicons;
  const queryIds = sources
    .filter((/** @type {any} */ source) => source.path && !source.id.endsWith(".defs"))
    .map((/** @type {any} */ source) => source.id);
  assert.ok(queryIds.length > 0);
  for (const id of queryIds) {
    assert.equal(lookup(api, id)?.main?.nsid, id, `${id} should be its query definition`);
  }
  // Records and other referenced definitions are the lexicon package's own
  // modules, not copies.
  for (const source of sources.filter((/** @type {any} */ source) => source.packagePath)) {
    const fromApi = lookup(api, source.id);
    assert.ok(fromApi, `${source.id} should be in the tree`);
    assert.equal(fromApi.main, lookup(records, source.id).main, `${source.id} is not shared`);
  }
});

test("a query sends its NSID and parameters and returns the validated body", async () => {
  /** @type {URL[]} */
  const requests = [];
  const client = new Client({
    service: "https://api.example",
    fetch: stubFetch({ badgeAwards: [] }, requests),
  });

  const body = await client.call(api.app.certified.badge.listBadgeAwards, {
    authors: ["did:plc:abc123"],
    limit: 5,
  });

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
  await assert.rejects(
    client.call(api.app.certified.badge.listBadgeAwards, {}),
    XrpcResponseValidationError,
  );
});

test("embedded records are validated with the schemas from @hypercerts-org/lexicon/records", async () => {
  const view = {
    uri: "at://did:plc:abc123/org.hypercerts.claim.activity/3k2abc",
    cid: "bafyreie5737gdxlw5i64vzichcalba3z2v5n6icifvx5xytvske7mr3hpm",
    indexedAt: "2026-10-30T12:00:00.000Z",
    did: "did:plc:abc123",
    author: { did: "did:plc:abc123", handle: null, profile: null, organization: null },
    record: {
      $type: "org.hypercerts.claim.activity",
      title: "Reforestation",
      shortDescription: "Planting native trees.",
      createdAt: "2026-10-30T12:00:00.000Z",
    },
    contributors: [],
  };
  const uri = /** @type {const} */ ("at://did:plc:abc123/org.hypercerts.claim.activity/3k2abc");
  const valid = new Client({
    service: "https://api.example",
    fetch: stubFetch({ activity: view }, []),
  });
  const body = await valid.call(api.org.hypercerts.claim.getActivity, { uri });
  assert.equal(body.activity.record.title, "Reforestation");

  const broken = { ...view, record: { ...view.record, title: 42 } };
  const invalid = new Client({
    service: "https://api.example",
    fetch: stubFetch({ activity: broken }, []),
  });
  await assert.rejects(
    invalid.call(api.org.hypercerts.claim.getActivity, { uri }),
    XrpcResponseValidationError,
  );
});
