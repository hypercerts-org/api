import assert from "node:assert/strict";
import test from "node:test";
import { graphDids, graphUris } from "./fixtures/graph-follows.fixture.js";
import { contractUrl, requireContractTarget } from "./helpers.js";

const baseUrl = requireContractTarget();
const endpoint = "app.certified.graph.getFollowerCounts";
const unfollowedDid = "did:plc:999999999999999999999999";
const unfollowedEntity = `at://${graphDids.entityAuthor}/org.hypercerts.entity.feature/3jzfcijpj2z2z`;

async function request(nsid, params) {
  const response = await fetch(contractUrl(baseUrl, nsid, params), {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body };
}

async function listTotal(nsid, params) {
  const { response, body } = await request(nsid, { ...params, limit: 1 });
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.totalCount;
}

test("getFollowerCounts batches DIDs and entity URIs and matches the list endpoints' totalCount", async () => {
  const subjects = [
    graphDids.primarySubject,
    graphUris.followedFeature,
    unfollowedDid,
    graphDids.secondSubject,
    graphUris.unresolvedFeature,
    graphDids.primarySubject,
    unfollowedEntity,
  ];
  const { response, body } = await request(endpoint, { subjects });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(
    body.counts.map(({ subject }) => subject),
    subjects,
    "one entry per requested occurrence, in request order",
  );

  const counts = body.counts.map(({ followerCount }) => followerCount);
  // Duplicate follows by one publisher count once: primarySubject and followedFeature
  // each have four follow records from three publishers.
  assert.deepEqual(counts, [3, 3, 0, 1, 1, 3, 0]);

  assert.equal(
    counts[0],
    await listTotal("app.certified.graph.listActorFollowers", { actor: graphDids.primarySubject }),
  );
  assert.equal(
    counts[1],
    await listTotal("app.certified.graph.listEntityFollowers", {
      entity: graphUris.followedFeature,
    }),
  );
  assert.equal(
    counts[3],
    await listTotal("app.certified.graph.listActorFollowers", { actor: graphDids.secondSubject }),
  );
  assert.equal(
    counts[4],
    await listTotal("app.certified.graph.listEntityFollowers", {
      entity: graphUris.unresolvedFeature,
    }),
  );
});

test("getFollowerCounts rejects a subject that is neither a DID nor a full AT-URI", async () => {
  const { response, body } = await request(endpoint, {
    subjects: [graphDids.primarySubject, "alice.example"],
  });
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, "script_error");
  assert.match(body.message, /InvalidRequest/);
});
