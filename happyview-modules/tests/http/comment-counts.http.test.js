import assert from "node:assert/strict";
import test from "node:test";
import { commentSubjects } from "./fixtures/comment-counts.fixture.js";
import { contractUrl, requireContractTarget } from "./helpers.js";

const baseUrl = requireContractTarget();
const endpoint = "org.hypercerts.context.getCommentCounts";
const uncommented =
  "at://did:web:comment-counts-post.invalid/org.hypercerts.claim.activity/3jzfcijpj2z2z";

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

test("getCommentCounts counts comment records per subject, in request order", async () => {
  const subjects = [
    commentSubjects.post,
    uncommented,
    commentSubjects.secondPost,
    commentSubjects.post,
  ];
  const { response, body } = await request(endpoint, { subjects });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.counts, [
    // Two by one author, one with another CID, one listing the post twice; the update is excluded.
    { subject: commentSubjects.post, commentCount: 4 },
    { subject: uncommented, commentCount: 0 },
    { subject: commentSubjects.secondPost, commentCount: 1 },
    { subject: commentSubjects.post, commentCount: 4 },
  ]);

  const listed = await request("org.hypercerts.context.listAttachments", {
    subjects: [commentSubjects.post],
    contentTypes: ["comment"],
    limit: 100,
  });
  assert.equal(listed.response.status, 200, JSON.stringify(listed.body));
  assert.equal(
    listed.body.attachments.length,
    4,
    "the count matches the comments listAttachments returns for the same subject",
  );
});
