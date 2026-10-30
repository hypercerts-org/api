// Loads the built package by its name, as a consumer would. No network access.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Client, XrpcResponseValidationError } from "@atproto/lex";
import * as api from "@hypercerts-org/api";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const manifest = JSON.parse(
  await readFile(new URL("../../../happyview-modules/manifest.json", import.meta.url), "utf8"),
);

/**
 * @param {unknown} body
 * @returns {typeof globalThis.fetch}
 */
const stubFetch = (body) => async () =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

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

test("every Lexicon in happyview-modules/manifest.json is at its NSID path", async () => {
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
  // modules, not copies: every export is the same object. (A record that also
  // has queries under its NSID, like org.hypercerts.collection, is a different
  // namespace object here, with the query modules added.)
  for (const source of sources.filter((/** @type {any} */ source) => source.packagePath)) {
    const fromApi = lookup(api, source.id);
    const fromRecords = lookup(records, source.id);
    assert.ok(fromApi, `${source.id} should be in the tree`);
    const keys = Object.keys(fromRecords);
    assert.ok(keys.length > 0, `${source.id} should have exports`);
    for (const key of keys) {
      assert.equal(fromApi[key], fromRecords[key], `${source.id}.${key} is not shared`);
    }
  }
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
    fetch: stubFetch({ activity: view }),
  });
  const body = await valid.call(api.org.hypercerts.claim.getActivity, { uri });
  assert.equal(body.activity.record.title, "Reforestation");

  const broken = { ...view, record: { ...view.record, title: 42 } };
  const invalid = new Client({
    service: "https://api.example",
    fetch: stubFetch({ activity: broken }),
  });
  await assert.rejects(
    invalid.call(api.org.hypercerts.claim.getActivity, { uri }),
    XrpcResponseValidationError,
  );
});
