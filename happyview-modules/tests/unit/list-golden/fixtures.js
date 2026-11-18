import { hexCursor } from "./harness.js";

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const TIMESTAMP = "2025-01-01T00:00:00Z";
const COLLECTION_URI = `at://${DID}/org.hypercerts.collection/3kabcdefghijk`;
const ACTIVITY_URI = `at://${DID}/org.hypercerts.claim.activity/3kabcdefghijk`;

/**
 * Cursor shape per endpoint, found by probing the current bundles: the record
 * collection the cursor `u` must point at, and which cursor layout the handler
 * decodes. `dir` is {v,d,t,u}; `before` adds b=false; `filter` adds f="";
 * `item` is the position cursor {v,u,i} used by collection items (no timestamp).
 * Timestamp format matters: acknowledgements only accept fractional seconds.
 */
const CURSORS = {
  "app.certified.actor.listOrganizations": {
    collection: "app.certified.actor.organization",
    rkey: "self",
  },
  "app.certified.actor.listProfiles": { collection: "app.certified.actor.profile", rkey: "self" },
  "app.certified.actor.searchOrganizations": {
    collection: "app.certified.actor.organization",
    rkey: "self",
  },
  "app.certified.actor.searchProfiles": { collection: "app.certified.actor.profile", rkey: "self" },
  "app.certified.badge.listBadgeAwards": { collection: "app.certified.badge.award" },
  "app.certified.badge.listBadgeDefinitions": { collection: "app.certified.badge.definition" },
  "app.certified.badge.listBadgeResponses": { collection: "app.certified.badge.response" },
  "app.certified.badge.searchBadgeDefinitions": { collection: "app.certified.badge.definition" },
  "app.certified.feed.getActorLikes": { collection: "app.certified.feed.like" },
  "app.certified.feed.getActorReposts": { collection: "app.certified.feed.repost" },
  "app.certified.feed.getLikes": { collection: "app.certified.feed.like" },
  "app.certified.feed.getReposts": { collection: "app.certified.feed.repost" },
  "app.certified.graph.listActorFollowers": { collection: "app.certified.graph.follow" },
  "app.certified.graph.listActorFollowing": { collection: "app.certified.graph.follow" },
  "app.certified.graph.listEntityFollowers": { collection: "app.certified.graph.entityFollow" },
  "app.certified.graph.listEntityFollowing": { collection: "app.certified.graph.entityFollow" },
  "app.certified.graph.listRecentFollows": {
    collection: "app.certified.graph.entityFollow",
    shape: "before",
  },
  "app.certified.link.listEvmLinks": { collection: "app.certified.link.evm" },
  "app.certified.location.listLocations": { collection: "app.certified.location" },
  "org.hypercerts.claim.listActivities": { collection: "org.hypercerts.claim.activity" },
  "org.hypercerts.claim.listContributions": { collection: "org.hypercerts.claim.contribution" },
  "org.hypercerts.claim.listContributorInformation": {
    collection: "org.hypercerts.claim.contributorInformation",
  },
  "org.hypercerts.claim.listRights": { collection: "org.hypercerts.claim.rights" },
  "org.hypercerts.claim.searchActivities": { collection: "org.hypercerts.claim.activity" },
  "org.hypercerts.collection.listCollectionItems": { shape: "item" },
  "org.hypercerts.collection.listCollections": { collection: "org.hypercerts.collection" },
  "org.hypercerts.collection.searchCollections": { collection: "org.hypercerts.collection" },
  "org.hypercerts.context.listAcknowledgements": {
    collection: "org.hypercerts.context.acknowledgement",
    timestamp: "2025-01-01T00:00:00.000000Z",
  },
  "org.hypercerts.context.listAttachments": { collection: "org.hypercerts.context.attachment" },
  "org.hypercerts.context.listEvaluations": { collection: "org.hypercerts.context.evaluation" },
  "org.hypercerts.context.listMeasurements": { collection: "org.hypercerts.context.measurement" },
  "org.hypercerts.entity.listFeatures": { collection: "org.hypercerts.entity.feature" },
  "org.hypercerts.funding.listReceipts": { collection: "org.hypercerts.funding.receipt" },
  "org.hypercerts.vocab.listVocabTags": { collection: "org.hypercerts.vocab.tag", shape: "filter" },
  "org.hypercerts.workscope.listWorkscopeTags": { collection: "org.hypercerts.workscope.tag" },
};

/** Required request parameters, chosen by lexicon name/format. */
function requiredValue(name, property) {
  if (name === "search") return "test";
  if (name === "collection") return COLLECTION_URI;
  if (property.format === "did") return DID;
  if (property.format === "at-uri") return ACTIVITY_URI;
  throw new Error(`No fixture value for required parameter "${name}"; add one to fixtures.js`);
}

export function baseParams(endpoint) {
  return Object.fromEntries(
    endpoint.required.map((name) => [name, requiredValue(name, endpoint.properties[name])]),
  );
}

/** A decodable cursor for the endpoint, or null if it has no fixture. */
export function cursorFor(endpoint, direction, year = "2025") {
  const spec = CURSORS[endpoint.id];
  if (!spec) return null;
  const timestamp = spec.timestamp ?? TIMESTAMP;
  const t = `${year}${timestamp.slice(4)}`;
  const u = `at://${DID}/${spec.collection}/${spec.rkey ?? "3kabcdefghijk"}`;
  if (spec.shape === "item") return { v: 1, u: COLLECTION_URI, i: 1 };
  if (spec.shape === "before") return { v: 1, t, u, b: false };
  if (spec.shape === "filter") return { v: 1, d: direction, f: "", t, u };
  return { v: 1, d: direction, t, u };
}

export function hasTimestampCursor(endpoint) {
  return CURSORS[endpoint.id]?.shape !== "item";
}

/**
 * Endpoints whose first query must return a row carrying `total_count` before
 * the handler proceeds; an empty fake result would stop them at that check.
 */
const COUNT_ROW_ENDPOINTS = new Set([
  "app.certified.feed.getLikes",
  "app.certified.feed.getReposts",
  "app.certified.graph.listActorFollowers",
  "app.certified.graph.listActorFollowing",
  "app.certified.graph.listEntityFollowers",
  "app.certified.graph.listEntityFollowing",
]);

const COLLECTION_ITEMS = [1, 2, 3].map((n) => ({
  itemIdentifier: {
    uri: `at://${DID}/org.hypercerts.claim.activity/3kitem${n}`,
    cid: `bafyitem${n}`,
  },
}));

/** Rows the fake db returns for every query of this endpoint, if any. */
function fakeRows(id) {
  if (COUNT_ROW_ENDPOINTS.has(id)) return [{ total_count: "0" }];
  if (id === "org.hypercerts.collection.listCollectionItems") {
    return [
      {
        uri: COLLECTION_URI,
        did: DID,
        cid: "bafyfixture",
        indexed_at: TIMESTAMP,
        record: JSON.stringify({ $type: "org.hypercerts.collection", items: COLLECTION_ITEMS }),
      },
    ];
  }
  return null;
}

export const CURSOR_FIXTURE_IDS = Object.keys(CURSORS);

/** Fixed input cases for one endpoint. Names starting `year0000:` are quarantined. */
export function casesFor(endpoint) {
  const base = baseParams(endpoint);
  const directions = endpoint.properties.sortDirection ? ["desc", "asc"] : [undefined];
  const withDirection = (direction) => (direction ? { sortDirection: direction } : {});
  const cursorParams = (direction, year) => ({
    ...base,
    ...withDirection(direction),
    cursor: hexCursor(cursorFor(endpoint, direction ?? "desc", year)),
  });

  const cases = [
    { name: "default", params: base },
    { name: "limit=1", params: { ...base, limit: 1 } },
    { name: "limit=7", params: { ...base, limit: 7 } },
    { name: "limit=100", params: { ...base, limit: 100 } },
    { name: "limit=0", params: { ...base, limit: 0 } },
    { name: "limit=101", params: { ...base, limit: 101 } },
    { name: "cursor:malformed", params: { ...base, cursor: "abc" } },
  ];
  for (const direction of directions) {
    const label = direction ?? "default";
    if (direction) {
      cases.push({ name: `sort=${label}`, params: { ...base, ...withDirection(direction) } });
    }
    cases.push({ name: `cursor:valid:${label}`, params: cursorParams(direction, "2025") });
    cases.push({
      name: `cursor:valid+limit=7:${label}`,
      params: { ...cursorParams(direction, "2025"), limit: 7 },
    });
    if (hasTimestampCursor(endpoint)) {
      cases.push({ name: `year0000:cursor:${label}`, params: cursorParams(direction, "0000") });
    }
  }
  const rows = fakeRows(endpoint.id);
  return rows ? cases.map((testCase) => ({ ...testCase, rows })) : cases;
}
