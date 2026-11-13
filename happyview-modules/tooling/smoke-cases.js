/**
 * One smoke case per installed query. Seeds (real records) are discovered at runtime from
 * list endpoints, so nothing here pins data that could drift between environments.
 *
 * - phase 1: list endpoints that need no input; their first items become seeds.
 * - phase 2: everything that needs a seed. A case whose seed is missing is skipped, not failed,
 *   because an environment may legitimately have no data of that kind.
 *
 * Output shape is validated generically against the lexicon (see smoke.js); `check` adds
 * endpoint-specific invariants.
 */

/** @typedef {Record<string, any>} Seeds */
/** @typedef {import("./smoke-core.js").QueryParams} QueryParams */
/**
 * @typedef {object} SmokeCase
 * @property {1 | 2} phase
 * @property {(seeds: Seeds) => QueryParams | undefined} params undefined = no seed, skip.
 * @property {(json: any) => Seeds} [collect] Seeds to record from a phase 1 response.
 * @property {(json: any, params: QueryParams) => string[]} [check] Extra invariants; [] = ok.
 */

const NS = {
  actor: "app.certified.actor",
  badge: "app.certified.badge",
  feed: "app.certified.feed",
  graph: "app.certified.graph",
  link: "app.certified.link",
  location: "app.certified.location",
  claim: "org.hypercerts.claim",
  collection: "org.hypercerts.collection",
  context: "org.hypercerts.context",
  entity: "org.hypercerts.entity",
  funding: "org.hypercerts.funding",
  vocab: "org.hypercerts.vocab",
  workscope: "org.hypercerts.workscope",
};

const LIST_PARAMS = () => ({ limit: 5 });

/** First word of at least 4 letters from the first string field found; a stable search term. */
export function searchTermFrom(record, fields = ["title", "name", "displayName"]) {
  for (const field of fields) {
    const value = record?.[field];
    const word = typeof value === "string" ? value.match(/\p{L}{4,}/u)?.[0] : undefined;
    if (word) return word;
  }
  return undefined;
}

/** Phase 1 list case that records the first item's URI under `seedKey` plus any `extra` seeds. */
function listCase(arrayKey, seedKey, extra) {
  return {
    phase: 1,
    params: LIST_PARAMS,
    collect: (json) => ({
      [seedKey]: json[arrayKey]?.[0]?.uri,
      ...extra?.(json[arrayKey] ?? []),
    }),
  };
}

/** Phase 2 `get*` case taking one record URI. */
const getByUri = (seedKey) => ({
  phase: 2,
  params: (s) => (s[seedKey] ? { uri: s[seedKey] } : undefined),
});

/** Phase 2 list/search case with optional seed-derived params. */
const withSeed = (build, check) => ({
  phase: 2,
  params: (s) => {
    try {
      return build(s);
    } catch {
      return undefined;
    }
  },
  check,
});

const nonEmpty = (key) => (json) =>
  (json[key]?.length ?? 0) > 0
    ? []
    : [`search for a term taken from an existing record returned no ${key}`];

/** @type {Record<string, SmokeCase>} */
export const SMOKE_CASES = {
  // ---- phase 1: lists that need no input ----
  [`${NS.actor}.listProfiles`]: listCase("profiles", "profileUri", (items) => ({
    actor: items[0]?.did,
    profileTerm: searchTermFrom(items[0]?.record),
  })),
  [`${NS.actor}.listOrganizations`]: listCase("actors", "orgUri", (items) => ({
    org: items[0]?.did,
    orgTerm: searchTermFrom(items[0]?.organization?.record, ["legalName"]),
  })),
  [`${NS.badge}.listBadgeAwards`]: listCase("badgeAwards", "badgeAward"),
  [`${NS.badge}.listBadgeDefinitions`]: listCase(
    "badgeDefinitions",
    "badgeDefinition",
    (items) => ({
      badgeTerm: searchTermFrom(items[0]?.record),
    }),
  ),
  [`${NS.badge}.listBadgeResponses`]: listCase("badgeResponses", "badgeResponse"),
  [`${NS.graph}.listRecentFollows`]: {
    phase: 1,
    params: LIST_PARAMS,
    collect: (json) => {
      const follows = json.follows ?? [];
      return {
        follower: follows[0]?.did,
        followed: follows
          .map((f) => f.record?.subject)
          .find((subject) => typeof subject === "string" && subject.startsWith("did:")),
      };
    },
  },
  [`${NS.link}.listEvmLinks`]: listCase("evmLinks", "evmLink"),
  [`${NS.location}.listLocations`]: listCase("locations", "location"),
  [`${NS.claim}.listActivities`]: listCase("activities", "activity", (items) => ({
    activityTerm: searchTermFrom(items[0]?.record),
  })),
  [`${NS.claim}.listContributions`]: listCase("contributions", "contribution"),
  [`${NS.claim}.listContributorInformation`]: listCase(
    "contributorInformation",
    "contributorInformation",
  ),
  [`${NS.claim}.listRights`]: listCase("rights", "rights"),
  [`${NS.collection}.listCollections`]: listCase("collections", "collection", (items) => ({
    collectionTerm: searchTermFrom(items[0]?.record),
  })),
  [`${NS.context}.listAcknowledgements`]: listCase("acknowledgements", "acknowledgement"),
  [`${NS.context}.listAttachments`]: listCase("attachments", "attachment"),
  [`${NS.context}.listEvaluations`]: listCase("evaluations", "evaluation"),
  [`${NS.context}.listMeasurements`]: listCase("measurements", "measurement"),
  [`${NS.entity}.listFeatures`]: listCase("features", "feature"),
  [`${NS.funding}.listReceipts`]: listCase("receipts", "receipt"),
  [`${NS.vocab}.listVocabTags`]: listCase("vocabTags", "vocabTag"),
  [`${NS.workscope}.listWorkscopeTags`]: listCase("workscopeTags", "workscopeTag"),

  // ---- phase 2: get by URI ----
  [`${NS.badge}.getBadgeAward`]: getByUri("badgeAward"),
  [`${NS.badge}.getBadgeDefinition`]: getByUri("badgeDefinition"),
  [`${NS.badge}.getBadgeResponse`]: getByUri("badgeResponse"),
  [`${NS.link}.getEvmLink`]: getByUri("evmLink"),
  [`${NS.location}.getLocation`]: getByUri("location"),
  [`${NS.claim}.getActivity`]: getByUri("activity"),
  [`${NS.claim}.getContribution`]: getByUri("contribution"),
  [`${NS.claim}.getContributorInformation`]: getByUri("contributorInformation"),
  [`${NS.claim}.getRights`]: getByUri("rights"),
  [`${NS.collection}.getCollection`]: getByUri("collection"),
  [`${NS.context}.getAcknowledgement`]: getByUri("acknowledgement"),
  [`${NS.context}.getAttachment`]: getByUri("attachment"),
  [`${NS.context}.getEvaluation`]: getByUri("evaluation"),
  [`${NS.context}.getMeasurement`]: getByUri("measurement"),
  [`${NS.entity}.getFeature`]: getByUri("feature"),
  [`${NS.funding}.getReceipt`]: getByUri("receipt"),
  [`${NS.vocab}.getVocabTag`]: getByUri("vocabTag"),
  [`${NS.workscope}.getWorkscopeTag`]: getByUri("workscopeTag"),

  // ---- phase 2: actors, graph, feed ----
  [`${NS.actor}.getProfile`]: withSeed((s) => ({ actor: need(s.actor) })),
  [`${NS.actor}.getProfiles`]: withSeed((s) => ({ actors: [need(s.actor)] })),
  [`${NS.actor}.getOrganization`]: withSeed((s) => ({ actor: need(s.org) })),
  [`${NS.actor}.getOrganizations`]: withSeed((s) => ({ actors: [need(s.org)] })),
  [`${NS.actor}.searchProfiles`]: withSeed(
    (s) => ({ search: need(s.profileTerm) }),
    nonEmpty("profiles"),
  ),
  [`${NS.actor}.searchOrganizations`]: withSeed(
    (s) => ({ search: need(s.orgTerm) }),
    nonEmpty("actors"),
  ),
  [`${NS.badge}.searchBadgeDefinitions`]: withSeed(
    (s) => ({ search: need(s.badgeTerm) }),
    nonEmpty("badgeDefinitions"),
  ),
  [`${NS.claim}.searchActivities`]: withSeed(
    (s) => ({ search: need(s.activityTerm) }),
    nonEmpty("activities"),
  ),
  [`${NS.collection}.searchCollections`]: withSeed(
    (s) => ({ search: need(s.collectionTerm) }),
    nonEmpty("collections"),
  ),
  [`${NS.collection}.listCollectionItems`]: withSeed((s) => ({
    collection: need(s.collection),
    limit: 5,
  })),
  [`${NS.graph}.getFollow`]: withSeed((s) => ({
    actor: need(s.follower),
    subject: need(s.followed),
  })),
  [`${NS.graph}.getFollows`]: withSeed((s) => ({
    actor: need(s.follower),
    subjects: [need(s.followed)],
  })),
  [`${NS.graph}.getFollowerCounts`]: withSeed((s) => ({
    subjects: [need(s.followed), need(s.follower)],
  })),
  [`${NS.graph}.listActorFollowers`]: withSeed((s) => ({ actor: need(s.followed), limit: 5 })),
  [`${NS.graph}.listActorFollowing`]: withSeed((s) => ({ actor: need(s.follower), limit: 5 })),
  [`${NS.graph}.listEntityFollowers`]: withSeed((s) => ({
    entity: need(s.entity ?? s.collection),
    limit: 5,
  })),
  [`${NS.graph}.listEntityFollowing`]: withSeed((s) => ({
    actor: need(s.entityFollower ?? s.follower),
    limit: 5,
  })),
  [`${NS.graph}.getEntityFollow`]: withSeed((s) => ({
    actor: need(s.entityFollower),
    entity: need(s.entity),
  })),
  [`${NS.graph}.getEntityFollows`]: withSeed((s) => ({
    actor: need(s.entityFollower),
    entities: [need(s.entity)],
  })),
  [`${NS.feed}.getLikes`]: withSeed((s) => ({ subject: need(s.activity), limit: 5 })),
  [`${NS.feed}.getReposts`]: withSeed((s) => ({ subject: need(s.activity), limit: 5 })),
  [`${NS.feed}.getReactionCounts`]: withSeed((s) => ({ subjects: [need(s.activity)] })),
  [`${NS.feed}.getActorLikes`]: withSeed((s) => ({ actor: need(s.follower), limit: 5 })),
  [`${NS.feed}.getActorReposts`]: withSeed((s) => ({ actor: need(s.follower), limit: 5 })),
  [`${NS.feed}.getActorReactions`]: withSeed((s) => ({
    actor: need(s.follower),
    subjects: [need(s.activity)],
  })),
  [`${NS.context}.getCommentCounts`]: withSeed((s) => ({ subjects: [need(s.activity)] })),
};

/** Throws (caught by withSeed → skip) when a seed was not discovered. */
function need(value) {
  if (value === undefined || value === null || value === "") throw new Error("missing seed");
  return value;
}

/**
 * Entity follows have no list endpoint of their own, so take one from the recent-follows feed
 * (it mixes account and entity follows). Returns no seeds when the feed has none; dependent
 * cases then skip.
 * @param {(nsid: string, params: QueryParams) => Promise<{ status: number; json: any }>} get
 * @returns {Promise<Seeds>}
 */
export async function discoverEntityFollow(get) {
  const res = await get(`${NS.graph}.listRecentFollows`, { limit: 100 });
  const follow = (res.status === 200 ? (res.json?.follows ?? []) : []).find(
    (f) => f.record?.$type === "app.certified.graph.entityFollow" && f.record?.subject?.uri,
  );
  return follow ? { entity: follow.record.subject.uri, entityFollower: follow.did } : {};
}
