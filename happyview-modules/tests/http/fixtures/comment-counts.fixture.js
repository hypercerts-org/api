import { encode } from "@atcute/cbor";
import * as CID from "@atcute/cid";

const attachmentCollection = "org.hypercerts.context.attachment";
const indexedAt = "2025-04-01T00:00:00.000Z";
const createdAt = "2025-03-20T00:00:00.000Z";
const firstCid = "bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const secondCid = "bafyreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

export const commentDids = {
  commenter: "did:web:comment-counts-a.invalid",
  secondCommenter: "did:web:comment-counts-b.invalid",
  postAuthor: "did:web:comment-counts-post.invalid",
  malformedCommenter: "did:web:comment-counts-malformed.invalid",
};

// Neither post is seeded: counts must not require the subject to be indexed.
export const commentSubjects = {
  post: `at://${commentDids.postAuthor}/${attachmentCollection}/3jzfcijpj2z2a`,
  secondPost: `at://${commentDids.postAuthor}/${attachmentCollection}/3jzfcijpj2z2b`,
};

function comment(subjects, contentType = "comment") {
  return { title: "Comment", createdAt, contentType, subjects };
}

const specs = [
  // Two comments by one author both count.
  [commentDids.commenter, "3jzfcijpj2z2a", comment([{ uri: commentSubjects.post, cid: firstCid }])],
  [commentDids.commenter, "3jzfcijpj2z2b", comment([{ uri: commentSubjects.post, cid: firstCid }])],
  // A different subject CID still matches by URI; one comment can cover two posts.
  [
    commentDids.secondCommenter,
    "3jzfcijpj2z2c",
    comment([
      { uri: commentSubjects.post, cid: secondCid },
      { uri: commentSubjects.secondPost, cid: firstCid },
    ]),
  ],
  // Listing the same subject twice counts the comment once.
  [
    commentDids.secondCommenter,
    "3jzfcijpj2z2d",
    comment([
      { uri: commentSubjects.post, cid: firstCid },
      { uri: commentSubjects.post, cid: secondCid },
    ]),
  ],
  // An update about the post is not a comment.
  [
    commentDids.secondCommenter,
    "3jzfcijpj2z2e",
    comment([{ uri: commentSubjects.post, cid: firstCid }], "update"),
  ],
  // Malformed comments must neither count nor make the query fail.
  [commentDids.malformedCommenter, "3jzfcijpj2z2a", comment("not-an-array")],
  [
    commentDids.malformedCommenter,
    "3jzfcijpj2z2b",
    comment([null, 7, { cid: firstCid }, { uri: 5 }]),
  ],
];

async function seedRow(did, rkey, fields) {
  const record = { $type: attachmentCollection, ...fields };
  return {
    uri: `at://${did}/${attachmentCollection}/${rkey}`,
    did,
    collection: attachmentCollection,
    rkey,
    cid: CID.toString(await CID.create(0x71, encode(record))),
    indexedAt,
    record,
  };
}

export const seedRows = await Promise.all(
  specs.map(([did, rkey, record]) => seedRow(did, rkey, record)),
);
