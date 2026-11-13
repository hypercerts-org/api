import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createHttpClient,
  parseFlags,
  renderSummary,
  resolveBaseUrl,
  writeStepSummary,
} from "./smoke-core.js";

/**
 * Deep, read-only checks on live data: pagination walks, 100-subject batches and loose
 * cross-endpoint count invariants. Ported from the one-off Python e2e run.
 *
 * Live data keeps changing, so no check pins a number. Counts are compared with `near`
 * (a small absolute/relative drift allowance) and everything else is >=, <= or non-empty.
 * Requests are sequential and paced; invalid-input behaviour is deliberately not tested here.
 */

const PACE_MS = 300;
const TIMEOUT_MS = 30_000;
const MAX_PAGES = 60;
const FAKE_DID = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa";
const FAKE_URI = `at://${FAKE_DID}/org.hypercerts.collection/3zzzzzzzzzzzz`;
const GRAPH = "app.certified.graph";
const FC = `${GRAPH}.getFollowerCounts`;
const CC = "org.hypercerts.context.getCommentCounts";
const LB = "app.certified.badge.listBadgeAwards";

/** Counts from two live reads may differ by a little between requests. */
export function near(a, b) {
  return Math.abs(a - b) <= Math.max(3, 0.02 * Math.max(a, b));
}

/** Thrown to mark a check as not applicable in this environment. */
class Skip extends Error {}
const need = (value, what) => {
  if (value === undefined || value === null || (Array.isArray(value) && !value.length))
    throw new Skip(`no ${what} in this environment`);
  return value;
};
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

/**
 * @param {ReturnType<typeof createHttpClient>["get"]} get
 * @param {string} nsid @param {Record<string, any>} params @param {string} key @param {number} limit
 */
export async function walk(get, nsid, params, key, limit = 100, maxPages = MAX_PAGES) {
  const items = [];
  const totals = new Set();
  let cursor;
  let pages = 0;
  do {
    const res = await get(nsid, { ...params, limit, ...(cursor ? { cursor } : {}) });
    expect(res.status === 200, `${nsid} page ${pages + 1} returned HTTP ${res.status}`);
    pages += 1;
    if (typeof res.json.totalCount === "number") totals.add(res.json.totalCount);
    items.push(...res.json[key]);
    cursor = res.json.cursor;
  } while (cursor && pages < maxPages);
  return { items, pages, totals: [...totals], complete: !cursor };
}

const unique = (xs) => new Set(xs).size === xs.length;

/** Core of every walk check: no duplicates, and (when complete) totalCount agrees with the walk. */
function expectConsistentWalk(w, idOf, label) {
  const ids = w.items.map(idOf);
  expect(unique(ids), `${label}: duplicate items across pages`);
  if (w.complete && w.totals.length) {
    const last = w.totals[w.totals.length - 1];
    expect(near(last, ids.length), `${label}: totalCount ${last} vs ${ids.length} items walked`);
  }
  return `walked ${ids.length} in ${w.pages} page(s)${w.complete ? "" : " (capped)"}`;
}

export function buildChecks(get) {
  /** @type {Record<string, any>} */
  const s = {};
  /** @type {Array<[string, () => Promise<string>]>} */
  const checks = [];
  const check = (name, fn) => checks.push([name, fn]);
  const getOk = async (nsid, params) => {
    const res = await get(nsid, params);
    expect(res.status === 200, `${nsid} returned HTTP ${res.status}`);
    return res.json;
  };

  check("discover: recent follows", async () => {
    const w = await walk(get, `${GRAPH}.listRecentFollows`, {}, "follows", 100, 3);
    const dids = w.items
      .map((f) => f.record?.subject)
      .filter((x) => typeof x === "string" && x.startsWith("did:"));
    const tally = new Map();
    for (const d of dids) tally.set(d, (tally.get(d) ?? 0) + 1);
    s.actors = [...tally]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([d]) => d);
    s.entities = [...new Set(w.items.map((f) => f.record?.subject?.uri).filter(Boolean))].slice(
      0,
      4,
    );
    need(s.actors, "followed accounts");
    return `${s.actors.length} accounts, ${s.entities.length} entities`;
  });

  check(
    "getFollowerCounts: mixed batch keeps order, unknowns are 0, duplicates repeated",
    async () => {
      const subjects = [
        ...s.entities.slice(0, 2),
        ...need(s.actors, "followed accounts"),
        FAKE_DID,
        FAKE_URI,
        s.actors[0],
      ];
      const { counts } = await getOk(FC, { subjects });
      expect(
        JSON.stringify(counts.map((c) => c.subject)) === JSON.stringify(subjects),
        "counts not in request order",
      );
      expect(
        counts.every((c) => Number.isInteger(c.followerCount) && c.followerCount >= 0),
        "followerCount not a non-negative integer",
      );
      const byKey = new Map(counts.map((c) => [c.subject, c.followerCount]));
      expect(
        byKey.get(FAKE_DID) === 0 && byKey.get(FAKE_URI) === 0,
        "unknown subjects should count 0",
      );
      expect(
        counts.at(-1).followerCount === counts[s.entities.slice(0, 2).length].followerCount,
        "duplicate subject got a different count",
      );
      s.followerCounts = byKey;
      return `${counts.length} counts`;
    },
  );

  check("getFollowerCounts: every recently followed account has >= 1 follower", async () => {
    const { counts } = await getOk(FC, { subjects: need(s.actors, "followed accounts") });
    const zero = counts.filter((c) => c.followerCount < 1).map((c) => c.subject);
    expect(
      !zero.length,
      `accounts from the recent-follows feed with 0 followers: ${zero.join(", ")}`,
    );
    return `${counts.length} accounts`;
  });

  check("getFollowerCounts: 100 DIDs in one request", async () => {
    const subjects = Array.from(
      { length: 100 },
      (_, i) => `did:plc:${String(i).padStart(24, "0")}`,
    );
    const { counts } = await getOk(FC, { subjects });
    expect(counts.length === 100, `expected 100 counts, got ${counts.length}`);
    return "100 counts";
  });

  check("getFollowerCounts: 50 realistic entity URIs in one request", async () => {
    const subjects = Array.from(
      { length: 50 },
      (_, i) =>
        `at://did:plc:${"a".repeat(24)}/org.hypercerts.collection/3mvnvx${String(i).padStart(7, "0")}`,
    );
    const { counts } = await getOk(FC, { subjects });
    expect(
      counts.length === 50 && counts.every((c) => c.followerCount === 0),
      "unknown entities should all count 0",
    );
    return "50 counts";
  });

  check("listEntityFollowers walk vs getFollowerCounts", async () => {
    const entity = need(s.entities, "followed entity")[0];
    const w = await walk(get, `${GRAPH}.listEntityFollowers`, { entity }, "followers");
    const note = expectConsistentWalk(w, (f) => f.did, "listEntityFollowers");
    s.entityFollowersWalk = w;
    const count = s.followerCounts?.get(entity);
    if (w.complete && count !== undefined)
      expect(near(count, w.items.length), `getFollowerCounts ${count} vs ${w.items.length} walked`);
    return note;
  });

  check("listEntityFollowers small pages (limit=7) match the large-page walk", async () => {
    const entity = need(s.entities, "followed entity")[0];
    const small = await walk(get, `${GRAPH}.listEntityFollowers`, { entity }, "followers", 7);
    const note = expectConsistentWalk(small, (f) => f.did, "limit=7");
    expect(
      small.totals.length <= 2,
      `totalCount changed ${small.totals.length} times during the walk`,
    );
    const large = s.entityFollowersWalk;
    if (small.complete && large?.complete) {
      const largeIds = new Set(large.items.map((f) => f.did));
      const shared = small.items.filter((f) => largeIds.has(f.did)).length;
      const most = Math.max(small.items.length, large.items.length);
      // Live data can change between walks, so allow the same drift as near().
      expect(
        near(shared, most),
        `limit=7 and limit=100 walks share ${shared} of ${most} followers`,
      );
    }
    return note;
  });

  check("listActorFollowers walks vs getFollowerCounts", async () => {
    const actors = need(s.actors, "followed accounts").slice(0, 3);
    const notes = [];
    for (const actor of actors) {
      const w = await walk(get, `${GRAPH}.listActorFollowers`, { actor }, "followers");
      notes.push(
        expectConsistentWalk(w, (f) => f.did ?? f.uri, `listActorFollowers ${actor.slice(-6)}`),
      );
      const count = s.followerCounts?.get(actor);
      if (w.complete && count !== undefined)
        expect(
          near(count, w.items.length),
          `${actor.slice(-6)}: count ${count} vs ${w.items.length} walked`,
        );
    }
    return notes.join("; ");
  });

  check("discover: commented subjects", async () => {
    const w = await walk(
      get,
      "org.hypercerts.context.listAttachments",
      { contentTypes: "comment" },
      "attachments",
      100,
      5,
    );
    const tally = new Map();
    for (const a of w.items)
      for (const sub of a.record?.subjects ?? [])
        if (sub.uri) tally.set(sub.uri, (tally.get(sub.uri) ?? 0) + 1);
    s.commented = [...tally]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([u]) => u);
    need(s.commented, "comment attachments");
    return `${s.commented.length} subjects`;
  });

  check("getCommentCounts: batch order, unknown = 0, >= 1 for commented subjects", async () => {
    const subjects = [...need(s.commented, "commented subjects"), FAKE_URI, s.commented[0]];
    const { counts } = await getOk(CC, { subjects });
    expect(
      JSON.stringify(counts.map((c) => c.subject)) === JSON.stringify(subjects),
      "counts not in request order",
    );
    const bySubject = new Map(counts.map((c) => [c.subject, c.commentCount]));
    expect(bySubject.get(FAKE_URI) === 0, "unknown subject should count 0");
    const low = s.commented.filter((u) => (bySubject.get(u) ?? 0) < 1);
    expect(
      !low.length,
      `subjects with comment attachments but commentCount < 1: ${low.join(", ")}`,
    );
    s.commentCounts = bySubject;
    return `${counts.length} counts`;
  });

  check("getCommentCounts vs listAttachments walk (limit=1)", async () => {
    const notes = [];
    for (const subject of need(s.commented, "commented subjects").slice(0, 3)) {
      const w = await walk(
        get,
        "org.hypercerts.context.listAttachments",
        { subjects: subject, contentTypes: "comment" },
        "attachments",
        1,
        30,
      );
      expect(unique(w.items.map((a) => a.uri)), "duplicate attachments across pages");
      const count = s.commentCounts?.get(subject);
      if (w.complete && count !== undefined)
        expect(near(count, w.items.length), `count ${count} vs ${w.items.length} walked`);
      notes.push(`${w.items.length}`);
    }
    return `walked ${notes.join("/")}`;
  });

  // 100 realistic ~80-character activity URIs hit a server-side limit (HTTP 500 on Test), so
  // this check stays at 50; do not raise it without checking the current limit.
  check("getCommentCounts: 50 subjects in one request", async () => {
    const subjects = Array.from(
      { length: 50 },
      (_, i) =>
        `at://did:plc:${"a".repeat(24)}/org.hypercerts.claim.activity/3mzfw${String(i).padStart(8, "0")}`,
    );
    const { counts } = await getOk(CC, { subjects });
    expect(counts.length === 50, `expected 50 counts, got ${counts.length}`);
    return "50 counts";
  });

  check("listBadgeAwards: totalCount only when includeTotal=true", async () => {
    const plain = await getOk(LB, { limit: 5 });
    expect(!("totalCount" in plain), "totalCount present without includeTotal");
    const off = await getOk(LB, { limit: 5, includeTotal: "false" });
    expect(!("totalCount" in off), "totalCount present with includeTotal=false");
    const on = await getOk(LB, { limit: 1, includeTotal: "true" });
    expect(
      Number.isInteger(on.totalCount) && on.totalCount >= on.badgeAwards.length,
      "includeTotal=true gave no usable totalCount",
    );
    s.awardTotal = on.totalCount;
    return `total ${on.totalCount}`;
  });

  check("listBadgeAwards: unknown author → empty page with totalCount 0", async () => {
    const j = await getOk(LB, { authors: FAKE_DID, includeTotal: "true" });
    expect(
      j.totalCount === 0 && j.badgeAwards.length === 0 && !j.cursor,
      `expected an empty result, got ${JSON.stringify(j).slice(0, 120)}`,
    );
    return "empty";
  });

  check("listBadgeAwards: per-author walks at limit 7 and 100 agree with totalCount", async () => {
    const page = await getOk(LB, { limit: 100 });
    const authors = [...new Set(page.badgeAwards.map((a) => a.did))].slice(0, 3);
    need(authors, "badge award authors");
    const notes = [];
    for (const author of authors) {
      const walks = [];
      for (const [limit, maxPages] of [
        [7, 25],
        [100, MAX_PAGES],
      ]) {
        const w = await walk(
          get,
          LB,
          { authors: author, includeTotal: "true" },
          "badgeAwards",
          limit,
          maxPages,
        );
        notes.push(
          expectConsistentWalk(w, (a) => a.uri, `author ${author.slice(-6)} limit=${limit}`),
        );
        walks.push(w);
      }
      const [small, large] = walks;
      if (small?.complete && large?.complete)
        expect(
          near(small.items.length, large.items.length),
          `author ${author.slice(-6)}: limit=7 walked ${small.items.length}, limit=100 walked ${large.items.length}`,
        );
    }
    return notes.length ? `${authors.length} authors` : "";
  });

  check("listBadgeAwards: sortDirection=asc walk reverses desc walk", async () => {
    const page = await getOk(LB, { limit: 100 });
    const author = need(page.badgeAwards, "badge awards")[0].did;
    const desc = await walk(get, LB, { authors: author, sortDirection: "desc" }, "badgeAwards");
    const asc = await walk(get, LB, { authors: author, sortDirection: "asc" }, "badgeAwards");
    if (!desc.complete || !asc.complete) throw new Skip("walk was capped");
    expect(
      near(desc.items.length, asc.items.length),
      `desc ${desc.items.length} vs asc ${asc.items.length} items`,
    );
    if (desc.items.length === asc.items.length)
      expect(
        JSON.stringify(desc.items.map((a) => a.uri)) ===
          JSON.stringify(asc.items.map((a) => a.uri).reverse()),
        "asc is not the reverse of desc",
      );
    return `${desc.items.length} items`;
  });

  check("listBadgeAwards: responses=rejected walk agrees with totalCount", async () => {
    const w = await walk(get, LB, { responses: "rejected", includeTotal: "true" }, "badgeAwards");
    return expectConsistentWalk(w, (a) => a.uri, "responses=rejected");
  });

  for (const [nsid, key] of [
    ["org.hypercerts.claim.listActivities", "activities"],
    ["org.hypercerts.collection.listCollections", "collections"],
    ["org.hypercerts.context.listAttachments", "attachments"],
  ]) {
    check(
      `${nsid}: small-page walk has no duplicates; asc and desc differ at the ends`,
      async () => {
        const w = await walk(get, nsid, {}, key, 7, 12);
        const note = expectConsistentWalk(w, (i) => i.uri, nsid);
        const desc = await getOk(nsid, { limit: 1, sortDirection: "desc" });
        const asc = await getOk(nsid, { limit: 1, sortDirection: "asc" });
        if (desc[key][0] && asc[key][0] && w.items.length > 1)
          expect(desc[key][0].uri !== asc[key][0].uri, "asc and desc start with the same record");
        return note;
      },
    );
  }

  return checks;
}

/** @param {string[]} argv */
export async function main(argv) {
  if (argv.includes("--help")) {
    console.log(
      "Usage: pnpm e2e [--base-url <url>]\nRead-only deep checks; API_BASE_URL is used when --base-url is not given.",
    );
    return 0;
  }
  const baseUrl = resolveBaseUrl(parseFlags(argv, ["base-url"]));
  const client = createHttpClient({ baseUrl, timeoutMs: TIMEOUT_MS, retries: 3, paceMs: PACE_MS });
  const started = Date.now();
  /** @type {import("./smoke-core.js").CheckResult[]} */
  const results = [];
  for (const [name, fn] of buildChecks(client.get)) {
    const t = Date.now();
    try {
      results.push({ name, status: "pass", ms: Date.now() - t, detail: await fn() });
    } catch (error) {
      const skipped = error instanceof Skip;
      results.push({
        name,
        status: skipped ? "skip" : "fail",
        ms: Date.now() - t,
        detail: /** @type {Error} */ (error).message,
      });
    }
    const last = results.at(-1);
    console.log(`${last?.status.toUpperCase().padEnd(4)} ${name}: ${last?.detail}`);
  }
  const markdown = renderSummary("Nightly e2e", results, {
    baseUrl,
    requests: client.requestCount,
    seconds: (Date.now() - started) / 1000,
  });
  await writeStepSummary(markdown);
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(/** @type {Error} */ (error).message);
    process.exitCode = 1;
  }
}
