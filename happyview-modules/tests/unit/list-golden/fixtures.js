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
  "app.certified.actor.listProfiles": {
    collection: "app.certified.actor.profile",
    rkey: "self",
  },
  "app.certified.actor.searchOrganizations": {
    collection: "app.certified.actor.organization",
    rkey: "self",
  },
  "app.certified.actor.searchProfiles": {
    collection: "app.certified.actor.profile",
    rkey: "self",
  },
  "app.certified.badge.listBadgeAwards": {
    collection: "app.certified.badge.award",
  },
  "app.certified.badge.listBadgeDefinitions": {
    collection: "app.certified.badge.definition",
  },
  "app.certified.badge.listBadgeResponses": {
    collection: "app.certified.badge.response",
  },
  "app.certified.badge.searchBadgeDefinitions": {
    collection: "app.certified.badge.definition",
  },
  "app.certified.feed.getActorLikes": { collection: "app.certified.feed.like" },
  "app.certified.feed.getActorReposts": {
    collection: "app.certified.feed.repost",
  },
  "app.certified.feed.getLikes": { collection: "app.certified.feed.like" },
  "app.certified.feed.getReposts": { collection: "app.certified.feed.repost" },
  "app.certified.graph.listActorFollowers": {
    collection: "app.certified.graph.follow",
  },
  "app.certified.graph.listActorFollowing": {
    collection: "app.certified.graph.follow",
  },
  "app.certified.graph.listEntityFollowers": {
    collection: "app.certified.graph.entityFollow",
  },
  "app.certified.graph.listEntityFollowing": {
    collection: "app.certified.graph.entityFollow",
  },
  "app.certified.graph.listRecentFollows": {
    collection: "app.certified.graph.entityFollow",
    shape: "before",
  },
  "app.certified.link.listEvmLinks": { collection: "app.certified.link.evm" },
  "app.certified.location.listLocations": {
    collection: "app.certified.location",
  },
  "org.hypercerts.claim.listActivities": {
    collection: "org.hypercerts.claim.activity",
  },
  "org.hypercerts.claim.listContributions": {
    collection: "org.hypercerts.claim.contribution",
  },
  "org.hypercerts.claim.listContributorInformation": {
    collection: "org.hypercerts.claim.contributorInformation",
  },
  "org.hypercerts.claim.listRights": {
    collection: "org.hypercerts.claim.rights",
  },
  "org.hypercerts.claim.searchActivities": {
    collection: "org.hypercerts.claim.activity",
  },
  "org.hypercerts.collection.listCollectionItems": { shape: "item" },
  "org.hypercerts.collection.listCollections": {
    collection: "org.hypercerts.collection",
  },
  "org.hypercerts.collection.searchCollections": {
    collection: "org.hypercerts.collection",
  },
  "org.hypercerts.context.listAcknowledgements": {
    collection: "org.hypercerts.context.acknowledgement",
    timestamp: "2025-01-01T00:00:00.000000Z",
  },
  "org.hypercerts.context.listAttachments": {
    collection: "org.hypercerts.context.attachment",
  },
  "org.hypercerts.context.listEvaluations": {
    collection: "org.hypercerts.context.evaluation",
  },
  "org.hypercerts.context.listMeasurements": {
    collection: "org.hypercerts.context.measurement",
  },
  "org.hypercerts.entity.listFeatures": {
    collection: "org.hypercerts.entity.feature",
  },
  "org.hypercerts.funding.listReceipts": {
    collection: "org.hypercerts.funding.receipt",
  },
  "org.hypercerts.vocab.listVocabTags": {
    collection: "org.hypercerts.vocab.tag",
    shape: "filter",
  },
  "org.hypercerts.workscope.listWorkscopeTags": {
    collection: "org.hypercerts.workscope.tag",
  },
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
export function cursorFor(endpoint, direction, year = "2025", tOverride = undefined) {
  const spec = CURSORS[endpoint.id];
  if (!spec) return null;
  const timestamp = spec.timestamp ?? TIMESTAMP;
  const t = tOverride ?? `${year}${timestamp.slice(4)}`;
  const u = `at://${DID}/${spec.collection}/${spec.rkey ?? "3kabcdefghijk"}`;
  if (spec.shape === "item") return { v: 1, u: COLLECTION_URI, i: 1 };
  if (spec.shape === "before") return { v: 1, t, u, b: false };
  if (spec.shape === "filter") return { v: 1, d: direction, f: "", t, u };
  return { v: 1, d: direction, t, u };
}

export function hasTimestampCursor(endpoint) {
  return CURSORS[endpoint.id]?.shape !== "item";
}

/** Valid-enough values for filter parameters, derived from the lexicon schema. */
const NAMED_STRINGS = {
  organizationTypes: ["nonprofit", "company", "dao"],
  visibility: ["public", "unlisted", "private"],
  badgeTypes: ["volunteer", "contributor", "steward"],
  locationTypes: ["coordinate-decimal", "geojson", "address"],
  contentTypes: ["image/png", "application/pdf", "text/plain"],
  types: ["project", "portfolio", "theme"],
  addresses: [0, 1, 2].map((n) => `0x${String(n + 1).repeat(40)}`),
  transactionIds: [0, 1, 2].map((n) => `0x${String(n + 1).repeat(64)}`),
  before: ["2025-06-01T00:00:00Z"],
};

/** Collection an AT-URI-valued filter must point at, by parameter name. */
const URI_COLLECTIONS = {
  badgeUris: "app.certified.badge.definition",
  badgeAward: "app.certified.badge.award",
  itemUris: "org.hypercerts.claim.activity",
  tagUris: "org.hypercerts.vocab.tag",
  forUris: "org.hypercerts.claim.activity",
  subjects: "org.hypercerts.claim.activity",
};

/** Unformatted string filters that accept either a DID or a record AT-URI. */
const MIXED_IDENTIFIERS = new Set(["subjects", "from", "to"]);

/** Endpoints whose mixed-identifier filters accept DIDs; the others take AT-URIs only. */
const MIXED_LIST_ENDPOINTS = new Set([
  "app.certified.badge.listBadgeAwards",
  "org.hypercerts.funding.listReceipts",
]);

const variant = (value, n) => `${value.slice(0, -1)}${"xyz"[n % 3]}`;
const rkey = (n) => `3kabcdefghij${"abc"[n % 3]}`;

/** The nth distinct valid value (0-2) for one filter parameter. */
function filterValue(endpoint, name, property, n) {
  const item = property.items ?? property;
  if (item.enum) return item.enum[n % item.enum.length];
  if (item.format === "did") return variant(DID, n);
  if (item.format === "at-uri") {
    const collection = URI_COLLECTIONS[name] ?? CURSORS[endpoint.id]?.collection;
    return `at://${DID}/${collection}/${rkey(n)}`;
  }
  if (MIXED_IDENTIFIERS.has(name)) {
    return n === 1 ? variant(DID, n) : `at://${DID}/org.hypercerts.claim.activity/${rkey(n)}`;
  }
  const named = NAMED_STRINGS[name];
  if (!named) throw new Error(`No fixture value for parameter "${name}"; add one to fixtures.js`);
  return named[n % named.length];
}

/** Optional filter parameters: everything except paging/sort and required inputs. */
function filterParams(endpoint) {
  const paging = new Set(["cursor", "limit", "sortDirection"]);
  return Object.entries(endpoint.properties).filter(
    ([name]) => !paging.has(name) && !endpoint.required.includes(name),
  );
}

/** Mixed DID and AT-URI identifiers: pins the separator of the DID IN-list. */
function mixedIdentifierCase(name, base) {
  const mixed = [0, 1, 2, 3].map((n) =>
    n % 2 === 1
      ? variant(DID, n >> 1)
      : `at://${DID}/org.hypercerts.claim.activity/${rkey(n >> 1)}`,
  );
  return {
    name: `filter:${name}:mixed-many`,
    params: { ...base, [name]: mixed },
  };
}

function arrayFilterCases(endpoint, name, property, base, index) {
  const values = [0, 1, 2].map((n) => filterValue(endpoint, name, property, n));
  const cases = [
    { name: `filter:${name}:many`, params: { ...base, [name]: values } },
    {
      name: `filter:${name}:one`,
      params: { ...base, [name]: values.slice(0, 1) },
    },
    {
      name: `filter:${name}:one-scalar`,
      params: { ...base, [name]: values[0] },
    },
    {
      name: `filter:${name}:duplicate`,
      params: { ...base, [name]: [values[0], values[0]] },
    },
    { name: `filter:${name}:empty`, params: { ...base, [name]: [] } },
  ];
  if (MIXED_IDENTIFIERS.has(name) && MIXED_LIST_ENDPOINTS.has(endpoint.id)) {
    cases.push(mixedIdentifierCase(name, base));
  }
  // Alternate the window so adjacent array filters get different value sets in
  // filter:all and a swap of their inputs changes the recorded binds.
  const start = index % 2;
  return { cases, combined: values.slice(start, start + 2) };
}

function booleanFilterCases(name, base) {
  const cases = [true, false, "true", "false"].map((value) => ({
    name: `filter:${name}=${typeof value}:${value}`,
    params: { ...base, [name]: value },
  }));
  return { cases, combined: true };
}

function scalarFilterCases(endpoint, name, property, base) {
  const values = [0, 1, 2].map((n) => filterValue(endpoint, name, property, n));
  const cases = values.map((value) => ({
    name: `filter:${name}=${value}`,
    params: { ...base, [name]: value },
  }));
  return { cases, combined: values[0] };
}

function filterCasesFor(endpoint, name, property, base, index) {
  if (property.type === "array") return arrayFilterCases(endpoint, name, property, base, index);
  if (property.type === "boolean") return booleanFilterCases(name, base);
  return scalarFilterCases(endpoint, name, property, base);
}

/** Required parameters that are themselves arrays are not supported by any current endpoint. */
function filterCases(endpoint, base) {
  const cases = [];
  const combined = {};
  for (const [index, [name, property]] of filterParams(endpoint).entries()) {
    const result = filterCasesFor(endpoint, name, property, base, index);
    cases.push(...result.cases);
    combined[name] = result.combined;
  }
  if (Object.keys(combined).length > 1) {
    cases.push({ name: "filter:all", params: { ...base, ...combined } });
  }
  return cases;
}

/** Days per month in a non-leap year, mirroring valid_datetime's month_days table. */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Last valid day and the day after it, for every month (February also in a leap year). */
function monthBoundaryCursors() {
  const pad = (n) => String(n).padStart(2, "0");
  const cases = {};
  const add = (year, month, day, verdict) => {
    cases[`day-${year}-${pad(month)}-${pad(day)}-${verdict}`] =
      `${year}-${pad(month)}-${pad(day)}T00:00:00Z`;
  };
  MONTH_DAYS.forEach((max, index) => {
    add(2025, index + 1, max, "valid");
    add(2025, index + 1, max + 1, "invalid");
  });
  add(2024, 2, 29, "valid");
  add(2024, 2, 30, "invalid");
  return cases;
}

/**
 * Cursor `t` values that pin lua/shared/datetimeValidation.lua valid_datetime
 * (calendar, clock and zone-offset boundaries). Run against every timestamp-
 * cursor endpoint rather than one per code path: bundles inline their own copy
 * of the helper, so each endpoint is its own code path and a refactor could
 * break any one. Acknowledgements accept only fractional-second cursors, so
 * their "valid" cases are rejected there; the other endpoints pin acceptance.
 */
const DATETIME_CURSORS = {
  "month-13": "2025-13-01T00:00:00Z",
  "feb-30": "2025-02-30T00:00:00Z",
  "leap-2024-valid": "2024-02-29T00:00:00Z",
  "feb-29-2100": "2100-02-29T00:00:00Z",
  "leap-2000-valid": "2000-02-29T00:00:00Z",
  "second-60": "2025-01-01T00:00:60Z",
  "hour-24": "2025-01-01T24:00:00Z",
  "zone-minus-00-00": "2025-01-01T00:00:00-00:00",
  "zone-plus-24-00": "2025-01-01T00:00:00+24:00",
  "zone-minute-60": "2025-01-01T00:00:00+05:60",
  "zone-plus-05-30-valid": "2025-01-01T00:00:00+05:30",
  "fraction-valid": "2025-01-01T00:00:00.123456Z",
  "fraction-offset-valid": "2025-01-01T00:00:00.5+05:30",
  "no-zone": "2025-01-01T00:00:00",
  "day-00": "2025-01-00T00:00:00Z",
  "minute-60": "2025-01-01T00:60:00Z",
  "fraction-empty": "2025-01-01T00:00:00.Z",
  "fraction-empty-offset": "2025-01-01T00:00:00.+05:30",
  "month-00": "2025-00-01T00:00:00Z",
  "lowercase-z": "2025-01-01T00:00:00z",
  "lowercase-t": "2025-01-01t00:00:00Z",
  "trailing-junk": "2025-01-01T00:00:00Zjunk",
  "zone-offset-trailing-junk": "2025-01-01T00:00:00+05:30junk",
  "fraction-offset-trailing-junk": "2025-01-01T00:00:00.5+05:30junk",
  "year-0001-valid": "0001-01-01T00:00:00Z",
  "year-5-digit": "12025-01-01T00:00:00Z",
  "end-of-year-valid": "2025-12-31T23:59:59Z",
  "zone-plus-15-59": "2025-01-01T00:00:00+15:59",
  "zone-minus-15-59": "2025-01-01T00:00:00-15:59",
  "zone-plus-16-00": "2025-01-01T00:00:00+16:00",
  "zone-minus-16-00": "2025-01-01T00:00:00-16:00",
  "zone-plus-23-59-lua-accepted": "2025-01-01T00:00:00+23:59",
  "zone-minus-23-59-lua-accepted": "2025-01-01T00:00:00-23:59",
  "feb-29-2026": "2026-02-29T00:00:00Z",
  "feb-29-2200": "2200-02-29T00:00:00Z",
  ...monthBoundaryCursors(),
};

const WHOLE_SECOND_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Endpoints whose cursor timestamp must carry fractional seconds. */
function needsFraction(endpoint) {
  return CURSORS[endpoint.id]?.timestamp?.includes(".") ?? false;
}

/** Cursor token length cap (hex characters) enforced by most shared decoders. */
const CURSOR_MAX_HEX = 8192;

/** Hex cursor of exactly `hexLength` characters, padded with trailing JSON whitespace. */
function paddedCursor(cursor, hexLength) {
  const json = JSON.stringify(cursor);
  return Buffer.from(json.padEnd(hexLength / 2, " "), "utf8").toString("hex");
}

/** Sort, limit and malformed-cursor cases that need no valid cursor for the endpoint. */
function basicErrorCases(endpoint, base) {
  const cases = [];
  if (endpoint.properties.sortDirection) {
    cases.push(
      {
        name: "error:sortDirection=bad",
        params: { ...base, sortDirection: "bad" },
      },
      {
        name: "error:sortDirection=ASC",
        params: { ...base, sortDirection: "ASC" },
      },
      {
        name: "error:sortDirection=empty",
        params: { ...base, sortDirection: "" },
      },
    );
  }
  for (const [label, limit] of [
    ["abc", "abc"],
    ["1.5", "1.5"],
    ["-1", "-1"],
    ["0-string", "0"],
    ["7-string", "7"],
    ["empty", ""],
  ]) {
    cases.push({ name: `error:limit=${label}`, params: { ...base, limit } });
  }
  // A query parameter repeated in the request arrives as an array; scalar() must reject it.
  cases.push({
    name: "error:limit=array",
    params: { ...base, limit: ["5", "6"] },
  });
  if (endpoint.properties.sortDirection) {
    cases.push({
      name: "error:sortDirection=array",
      params: { ...base, sortDirection: ["asc", "desc"] },
    });
  }
  cases.push(
    { name: "error:cursor:non-hex", params: { ...base, cursor: "zz" } },
    { name: "error:cursor:empty", params: { ...base, cursor: "" } },
    {
      name: "error:cursor:hex-non-json",
      params: { ...base, cursor: Buffer.from("not json", "utf8").toString("hex") },
    },
  );
  return cases;
}

/** Ways to corrupt a valid decoded cursor, keyed by case label. */
function cursorMutations(endpoint, good) {
  const mutations = {
    "wrong-v": (c) => (c.v = 2),
    "wrong-collection": (c) => (c.u = `at://${DID}/app.bsky.feed.post/3kabcdefghijk`),
    "missing-u": (c) => delete c.u,
    "u-number": (c) => (c.u = 123),
    "extra-key": (c) => (c.x = 1),
  };
  // Fixed-rkey collections (profile/organization "self") must reject any other rkey.
  if (CURSORS[endpoint.id]?.rkey) {
    mutations["wrong-rkey"] = (c) =>
      (c.u = `at://${DID}/${CURSORS[endpoint.id].collection}/3kabcdefghijk`);
  }
  // A sibling collection sharing the "app.certified.badge." prefix must not pass a prefix check.
  if (endpoint.id === "app.certified.badge.searchBadgeDefinitions") {
    mutations["sibling-collection"] = (c) =>
      (c.u = `at://${DID}/app.certified.badge.award/3kabcdefghijk`);
  }
  if ("d" in good) {
    mutations["wrong-d"] = (c) => (c.d = "sideways");
    mutations["opposite-d"] = (c) => (c.d = good.d === "asc" ? "desc" : "asc");
  }
  if ("t" in good) {
    mutations["bad-t"] = (c) => (c.t = "not-a-datetime");
    mutations["t-number"] = (c) => (c.t = 123);
    mutations["missing-t"] = (c) => delete c.t;
  }
  if ("i" in good) {
    mutations["bad-i"] = (c) => (c.i = "one");
    mutations["missing-i"] = (c) => delete c.i;
    mutations["i-zero"] = (c) => (c.i = 0);
    mutations["i-negative"] = (c) => (c.i = -1);
    mutations["i-fractional"] = (c) => (c.i = 1.5);
  }
  if ("b" in good) mutations["bad-b"] = (c) => (c.b = "no");
  return mutations;
}

/** Cursor cases built from a valid cursor (`good`) that is then corrupted or resized. */
function cursorErrorCases(endpoint, base, direction, good) {
  const withCursor = (cursor, extra = {}) => ({
    ...base,
    ...(direction ? { sortDirection: direction } : {}),
    ...extra,
    cursor,
  });
  const validHex = hexCursor(good);
  const cases = [
    { name: "error:cursor:array", params: withCursor([validHex, validHex]) },
    {
      name: "error:cursor:uppercase-hex",
      params: withCursor(validHex.toUpperCase()),
    },
  ];
  // Most shared decoders cap the token at CURSOR_MAX_HEX characters (even
  // length, so +/-2 is the nearest accepted/rejected neighbour); the organization
  // decoders do not. These are characterization cases, so the golden records
  // whichever outcome each endpoint has. Padding with trailing JSON whitespace
  // keeps the payload valid, so only the length varies.
  for (const [label, hexLength] of [
    ["at-cap", CURSOR_MAX_HEX],
    ["below-cap", CURSOR_MAX_HEX - 2],
    ["above-cap", CURSOR_MAX_HEX + 2],
  ]) {
    cases.push({
      name: `cursor:length-${label}`,
      params: withCursor(paddedCursor(good, hexLength)),
    });
  }
  if ("t" in good) {
    for (const [label, t] of Object.entries(DATETIME_CURSORS)) {
      const cursor = cursorFor(endpoint, direction ?? "desc", "2025", t);
      cases.push({
        name: `datetime:cursor-t:${label}`,
        params: withCursor(hexCursor(cursor)),
      });
      // Fractional-only endpoints reject whole-second values on format alone,
      // so also exercise the same calendar/clock value in the accepted format.
      if (needsFraction(endpoint) && WHOLE_SECOND_UTC.test(t)) {
        const fractional = cursorFor(
          endpoint,
          direction ?? "desc",
          "2025",
          t.replace("Z", ".000000Z"),
        );
        cases.push({
          name: `datetime:cursor-t:${label}:fractional`,
          params: withCursor(hexCursor(fractional)),
        });
      }
    }
  }
  for (const [label, mutate] of Object.entries(cursorMutations(endpoint, good))) {
    const cursor = { ...good };
    mutate(cursor);
    cases.push({
      name: `error:cursor:${label}`,
      params: withCursor(hexCursor(cursor)),
    });
  }
  return cases;
}

/** Input-validation cases that must be rejected before (or without) reaching SQL. */
function errorCases(endpoint, base, directions) {
  const cases = basicErrorCases(endpoint, base);
  const direction = directions[0];
  const good = cursorFor(endpoint, direction ?? "desc", "2025");
  if (!good) return cases;
  return [...cases, ...cursorErrorCases(endpoint, base, direction, good)];
}

/**
 * Endpoints whose first query must return a row carrying `total_count` before
 * the handler proceeds; an empty fake result would stop them at that check.
 * Only that first query gets the row: replaying it for hydration queries
 * would feed a record-less row to record decoders.
 */
const COUNT_ROW_ENDPOINTS = new Set([
  "app.certified.feed.getLikes",
  "app.certified.feed.getReposts",
  "app.certified.graph.listActorFollowers",
  "app.certified.graph.listActorFollowing",
  "app.certified.graph.listEntityFollowers",
]);

/** Follow records name their target; entity-following scans decode it from the row. */
function followSubject(collection, n) {
  if (collection === "app.certified.graph.entityFollow") {
    return {
      subject: {
        uri: `at://${rowDid(n)}/org.hypercerts.claim.activity/3kabcdefghijk`,
        cid: `bafyactivity${n}`,
      },
    };
  }
  if (collection === "app.certified.graph.follow") return { subject: rowDid(n) };
  return {};
}

/** Distinct DID per page row, so hydration `IN (...)` lists bind several values. */
function rowDid(n) {
  return `did:plc:abcdefghijklmnopqrstuvw${"xyz"[n]}`;
}

/** Organization records point at a location; distinct URIs make the location IN-list bind several. */
function locationRef(collection, n) {
  if (collection !== "app.certified.actor.organization") return {};
  return {
    location: {
      uri: `at://${rowDid(n)}/app.certified.location/3klocation${n}`,
      cid: `bafylocation${n}`,
    },
  };
}

/** One generic row carrying every column any list query selects. */
function pageRow(endpoint, n) {
  const spec = CURSORS[endpoint.id] ?? {};
  const collection = spec.collection ?? "org.hypercerts.claim.activity";
  const uri = `at://${rowDid(n)}/${collection}/${spec.rkey ?? rkey(n)}`;
  const createdAt = `2025-01-0${n + 1}T00:00:00Z`;
  return {
    uri,
    did: rowDid(n),
    cid: `bafyfixture${n}`,
    indexed_at: createdAt,
    created_at: createdAt,
    record: JSON.stringify({
      $type: collection,
      createdAt,
      ...followSubject(collection, n),
      ...locationRef(collection, n),
    }),
    sort_timestamp: `2025-01-0${n + 1}T00:00:00.000000Z`,
    actor_did: rowDid(n),
    subject_did: rowDid(n),
    total_count: String(TOTAL_COUNT),
  };
}

const PAGE_ROWS = 3;
/** Database total, deliberately different from PAGE_ROWS so totals are not confused with page size. */
const TOTAL_COUNT = 12;

const collectionItems = (count) =>
  Array.from({ length: count }, (_, index) => index + 1).map((n) => ({
    itemIdentifier: {
      uri: `at://${DID}/org.hypercerts.claim.activity/3kitem${n}`,
      cid: `bafyitem${n}`,
    },
  }));

const COLLECTION_ITEMS = collectionItems(3);

/**
 * Rows for a page of `limit` = PAGE_ROWS - 1, so the handler sees limit+1 rows
 * on its main (first) query and must encode a nextCursor. Later queries
 * (hydration, counts) get no rows.
 */
function collectionRow(items) {
  return {
    uri: COLLECTION_URI,
    did: DID,
    cid: "bafyfixture",
    indexed_at: TIMESTAMP,
    record: JSON.stringify({ $type: "org.hypercerts.collection", items }),
  };
}

/** Rows come back in SQL order: newest first unless the request sorts ascending. */
function pagedRowsByCall(endpoint, direction) {
  if (endpoint.id === "org.hypercerts.collection.listCollectionItems") {
    return [[collectionRow(COLLECTION_ITEMS)]];
  }
  const rows = Array.from({ length: PAGE_ROWS }, (_, n) => pageRow(endpoint, n));
  return [direction === "asc" ? rows : rows.reverse()];
}

/** Only the collection lookup returns the collection row; later queries see no rows. */
function defaultRowsByCall(endpoint) {
  if (endpoint.id !== "org.hypercerts.collection.listCollectionItems") return null;
  return pagedRowsByCall(endpoint);
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
    { name: "limit=99", params: { ...base, limit: 99 } },
    { name: "limit=100", params: { ...base, limit: 100 } },
    { name: "limit=0", params: { ...base, limit: 0 } },
    { name: "limit=101", params: { ...base, limit: 101 } },
    { name: "cursor:malformed", params: { ...base, cursor: "abc" } },
  ];
  for (const direction of directions) {
    const paged = pagedRowsByCall(endpoint, direction);
    const label = direction ?? "default";
    if (direction) {
      cases.push({
        name: `sort=${label}`,
        params: { ...base, ...withDirection(direction) },
      });
    }
    cases.push(
      {
        name: `paged:${label}`,
        params: { ...base, ...withDirection(direction), limit: PAGE_ROWS - 1 },
        rowsByCall: paged,
      },
      {
        name: `cursor:valid:${label}`,
        params: cursorParams(direction, "2025"),
      },
      {
        name: `cursor:valid+limit=7:${label}`,
        params: { ...cursorParams(direction, "2025"), limit: 7 },
      },
    );
    if (hasTimestampCursor(endpoint)) {
      cases.push({
        name: `year0000:cursor:${label}`,
        params: cursorParams(direction, "0000"),
      });
    }
  }
  if (endpoint.properties.includeTotal) {
    const direction = directions[0] ?? "desc";
    cases.push(
      {
        name: "paged:includeTotal",
        params: { ...base, limit: PAGE_ROWS - 1, includeTotal: true },
        rowsByCall: pagedRowsByCall(endpoint, direction),
      },
      {
        name: "empty:includeTotal",
        params: { ...base, includeTotal: true },
        rowsByCall: [[{ total_count: "0" }]],
      },
      {
        name: "past-end:includeTotal",
        params: {
          ...base,
          sortDirection: direction,
          includeTotal: true,
          cursor: hexCursor(cursorFor(endpoint, direction, "2025")),
        },
        rowsByCall: [[{ total_count: String(TOTAL_COUNT) }]],
      },
      ...[
        ["negative", "-1"],
        ["fractional", "1.5"],
        ["unsafe", "9007199254740992"],
        ["invalid", "not-a-number"],
      ].map(([label, total_count]) => ({
        name: `error:includeTotal-count-${label}`,
        params: { ...base, includeTotal: true },
        rowsByCall: [[{ total_count }]],
      })),
    );
  }
  if (
    endpoint.id === "org.hypercerts.claim.searchActivities" ||
    endpoint.id === "org.hypercerts.collection.searchCollections"
  ) {
    cases.push({
      name: "error:includeTotal-on-search",
      params: { ...base, includeTotal: true },
    });
  }
  if (endpoint.id === "org.hypercerts.collection.listCollectionItems") {
    // More items than the default page size, no limit: pins the default limit (25) and its cursor.
    cases.push({
      name: "default-limit:30-items",
      params: base,
      rowsByCall: [[collectionRow(collectionItems(30))]],
    });
  }
  if (endpoint.properties.includeTotal) {
    cases.push(
      { name: "error:includeTotal-invalid", params: { ...base, includeTotal: "sometimes" } },
      { name: "error:includeTotal-repeated", params: { ...base, includeTotal: ["true", "false"] } },
    );
  }
  cases.push(...filterCases(endpoint, base), ...errorCases(endpoint, base, directions));
  // Unpaged cases answer every query with the same minimal rows (if any is
  // needed to get past a count check); paged cases bring their own.
  const rowsByCall = defaultRowsByCall(endpoint);
  const countCall = COUNT_ROW_ENDPOINTS.has(endpoint.id) ? [[{ total_count: "0" }]] : null;
  return cases.map((c) => {
    if (c.rowsByCall) return c;
    if (String(c.params.includeTotal) === "true")
      return { ...c, rowsByCall: [[{ total_count: "0" }]] };
    if (countCall) return { ...c, rowsByCall: countCall };
    return rowsByCall ? { ...c, rowsByCall } : c;
  });
}
