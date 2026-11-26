import assert from "node:assert/strict";
import test from "node:test";
import { requireContractTarget } from "./helpers.js";

// A repeated array parameter reaches Lua as a list (`?k=a&k=b`). HappyView does not
// build keyed or sparse tables from `k[x]`, `k[2]`, `k.x`: it hands those over as
// differently named parameters, which the handlers' unknown-parameter check rejects
// before any array parser runs. The array parsers can therefore treat a non-list
// table as impossible input.
const KEYED_FORMS = (key) => [`${key}[x]`, `${key}[2]`, `${key}[0]`, `${key}[]`, `${key}.x`];

const ENDPOINTS = [
  ["app.certified.actor.searchProfiles", "search=a", ["actors"]],
  [
    "app.certified.badge.listBadgeAwards",
    "",
    ["authors", "badgeUris", "badgeTypes", "subjects", "responses"],
  ],
  ["app.certified.badge.listBadgeDefinitions", "", ["authors", "badgeTypes"]],
  ["app.certified.badge.searchBadgeDefinitions", "search=a", ["authors", "badgeTypes"]],
  ["app.certified.link.listEvmLinks", "", ["actors", "addresses"]],
  ["app.certified.location.listLocations", "", ["authors", "uris", "locationTypes"]],
  ["org.hypercerts.entity.listFeatures", "", ["authors", "types"]],
];

test("keyed and sparse array-parameter spellings never reach the array parsers", async () => {
  const base = requireContractTarget();
  for (const [nsid, fixed, keys] of ENDPOINTS) {
    for (const key of keys) {
      for (const spelling of KEYED_FORMS(key)) {
        const url = `${base.origin}/xrpc/${nsid}?${fixed ? `${fixed}&` : ""}${encodeURIComponent(spelling)}=x`;
        const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const body = await response.json();
        assert.notEqual(response.status, 200, `${nsid} accepted ${spelling}`);
        assert.match(
          body.message,
          /InvalidRequest: unknown query parameter/,
          `${nsid} ${spelling}`,
        );
      }
    }
  }
});
