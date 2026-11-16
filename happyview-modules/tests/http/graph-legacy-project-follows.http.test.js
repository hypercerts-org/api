import assert from "node:assert/strict";
import test from "node:test";
import { graphDids, legacyFollowUris } from "./fixtures/graph-follows.fixture.js";
import { contractUrl, requireContractTarget } from "./helpers.js";

const baseUrl = requireContractTarget();
const org = graphDids.legacyOrg;

async function request(nsid, params) {
  const response = await fetch(contractUrl(baseUrl, nsid, params), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

// Followers of the org: the publisher with a legacy project follow and a genuine follow
// counts once (through the genuine record); the legacy-only publisher is absent.
const expectedFollowers = [
  graphDids.legitViaStarterPack,
  graphDids.legitViaOtherCollection,
  graphDids.legacyThenPlain,
];

test("listActorFollowers excludes legacy project follows and keeps real via follows", async () => {
  const body = await request("app.certified.graph.listActorFollowers", { actor: org });

  assert.deepEqual(
    body.followers.map(({ did }) => did),
    expectedFollowers,
  );
  assert.equal(body.totalCount, expectedFollowers.length);
  const representative = body.followers.find(({ did }) => did === graphDids.legacyThenPlain);
  assert.equal(representative.follow.uri, legacyFollowUris.plainLater);
  assert.equal(representative.follow.record.via, undefined);
});

test("listActorFollowing omits an org that was only followed through a legacy project follow", async () => {
  const legacyOnly = await request("app.certified.graph.listActorFollowing", {
    actor: graphDids.legacyOnly,
  });
  assert.deepEqual(legacyOnly.following, []);
  assert.equal(legacyOnly.totalCount, 0);

  const legit = await request("app.certified.graph.listActorFollowing", {
    actor: graphDids.legitViaOtherCollection,
  });
  assert.equal(legit.totalCount, 1);
  assert.equal(legit.following[0].follow.uri, legacyFollowUris.legitCollection);
});

test("getFollow and getFollows return null for legacy project follows and the genuine record when both exist", async () => {
  const legacyOnly = await request("app.certified.graph.getFollow", {
    actor: graphDids.legacyOnly,
    subject: org,
  });
  assert.equal(legacyOnly.follow, null);

  const both = await request("app.certified.graph.getFollow", {
    actor: graphDids.legacyThenPlain,
    subject: org,
  });
  assert.equal(both.follow.uri, legacyFollowUris.plainLater);

  const legit = await request("app.certified.graph.getFollow", {
    actor: graphDids.legitViaStarterPack,
    subject: org,
  });
  assert.equal(legit.follow.uri, legacyFollowUris.legitStarterPack);

  const batch = await request("app.certified.graph.getFollows", {
    actor: graphDids.legacyOnly,
    subjects: [org],
  });
  assert.deepEqual(batch.results, [{ subject: org, follow: null }]);
});

test("getFollowerCounts, listActorFollowers and listRecentFollows agree on legacy project follows", async () => {
  const counts = await request("app.certified.graph.getFollowerCounts", { subjects: [org] });
  assert.deepEqual(counts.counts, [{ subject: org, followerCount: expectedFollowers.length }]);

  const list = await request("app.certified.graph.listActorFollowers", { actor: org, limit: 1 });
  assert.equal(list.totalCount, counts.counts[0].followerCount);

  const uris = [];
  let cursor;
  do {
    const page = await request("app.certified.graph.listRecentFollows", { limit: 5, cursor });
    uris.push(...page.follows.map(({ uri }) => uri));
    cursor = page.cursor;
  } while (cursor);
  assert.ok(uris.includes(legacyFollowUris.legitCollection));
  assert.ok(uris.includes(legacyFollowUris.legitStarterPack));
  assert.ok(uris.includes(legacyFollowUris.plainLater));
  assert.ok(!uris.includes(legacyFollowUris.legacyOnly));
  assert.ok(!uris.includes(legacyFollowUris.legacyEarlier));
});
