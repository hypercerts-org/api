import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const likeCollection = 'app.certified.feed.like';
const repostCollection = 'app.certified.feed.repost';
const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const indexedAt = '2025-04-01T00:00:00.000Z';

export const reactionDids = {
  actorA: 'did:web:feed-reactions-actor-a.invalid',
  actorB: 'did:web:feed-reactions-actor-b.invalid',
  actorC: 'did:web:feed-reactions-actor-c.invalid',
  actorD: 'did:web:feed-reactions-actor-d.invalid',
  source: 'did:web:feed-reactions-source.invalid',
  target: 'did:web:feed-reactions-target.invalid',
};

export const reactionUris = {
  subject: `at://${reactionDids.target}/org.example.unindexed/subject`,
  otherSubject: `at://${reactionDids.target}/org.example.unindexed/other`,
};

// Keep the LexJSON $bytes wrapper so CBOR hashing and pinned-schema validation use the same raw bytes.
function signatureBytes(values) {
  return { $bytes: Buffer.from(values).toString('base64') };
}

async function unindexedSubjectCid(version) {
  return CID.toString(await CID.create(0x71, encode({ $type: 'org.example.unindexed', version })));
}

export const subjectCids = {
  likeA: await unindexedSubjectCid('like-a'),
  likeB: await unindexedSubjectCid('like-b'),
  likeC: await unindexedSubjectCid('like-c'),
  likeD: await unindexedSubjectCid('like-d'),
  likeE: await unindexedSubjectCid('like-e'),
  otherLike: await unindexedSubjectCid('other-like'),
  repostA: await unindexedSubjectCid('repost-a'),
  repostB: await unindexedSubjectCid('repost-b'),
  repostC: await unindexedSubjectCid('repost-c'),
  repostD: await unindexedSubjectCid('repost-d'),
  otherRepost: await unindexedSubjectCid('other-repost'),
};

async function seedRow(collection, did, rkey, fields, rowIndexedAt = indexedAt) {
  const record = { $type: collection, ...fields };
  return {
    uri: `at://${did}/${collection}/${rkey}`,
    did,
    collection,
    rkey,
    cid: CID.toString(await CID.create(0x71, encode(record))),
    indexedAt: rowIndexedAt,
    record,
  };
}

function like(did, rkey, createdAt, cid, extras = {}) {
  return seedRow(likeCollection, did, rkey, {
    subject: { uri: reactionUris.subject, cid },
    createdAt,
    ...extras,
  });
}

function repost(did, rkey, createdAt, subjectUri, cid, extras = {}) {
  return seedRow(repostCollection, did, rkey, {
    subject: { uri: subjectUri, cid },
    createdAt,
    ...extras,
  });
}

const sourceReference = {
  uri: `at://${reactionDids.source}/app.certified.feed.repost/3jzfcijpj2z2a`,
  cid: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
};

const likeRows = [
  like(reactionDids.actorA, '3jzfcijpj2z2a', '2025-02-01T00:00:00.000Z', subjectCids.likeA, {
    via: sourceReference,
    signatures: [{
      $type: 'app.certified.signature.defs#inline',
      signature: signatureBytes([1, 2, 3]),
      key: `${reactionDids.actorA}#test-key`,
    }],
  }),
  like(reactionDids.actorA, '3jzfcijpj2z2b', '2025-02-01T00:00:00.000Z', subjectCids.likeB),
  like(reactionDids.actorA, '3jzfcijpj2z2c', '2025-02-03T00:00:00.000Z', subjectCids.likeC),
  like(reactionDids.actorB, '3jzfcijpj2z2d', '2025-02-01T00:00:00.000Z', subjectCids.likeD),
  like(reactionDids.actorC, '3jzfcijpj2z2e', '2025-02-01T00:00:00.000Z', subjectCids.likeE),
  seedRow(likeCollection, reactionDids.actorA, '3jzfcijpj2z2f', {
    subject: { uri: reactionUris.otherSubject, cid: subjectCids.otherLike },
    createdAt: '2025-02-01T00:00:00.000Z',
  }),
];

const repostRows = [
  repost(reactionDids.actorA, '3jzfcijpj2z2a', '2025-02-01T00:00:00.000Z', reactionUris.subject, subjectCids.repostA, {
    via: sourceReference,
    signatures: [{
      $type: 'app.certified.signature.defs#inline',
      signature: signatureBytes([4, 5, 6]),
      key: `${reactionDids.actorA}#test-key`,
    }],
  }),
  repost(reactionDids.actorA, '3jzfcijpj2z2b', '2025-02-01T00:00:00.000Z', reactionUris.subject, subjectCids.repostB),
  repost(reactionDids.actorA, '3jzfcijpj2z2c', '2025-02-03T00:00:00.000Z', reactionUris.subject, subjectCids.repostC),
  repost(reactionDids.actorD, '3jzfcijpj2z2d', '2025-02-01T00:00:00.000Z', reactionUris.subject, subjectCids.repostD),
  repost(reactionDids.actorA, '3jzfcijpj2z2e', '2025-02-01T00:00:00.000Z', reactionUris.otherSubject, subjectCids.otherRepost),
];

const sidecars = [
  seedRow(profileCollection, reactionDids.actorA, 'self', {
    displayName: 'Reaction actor A',
    createdAt: indexedAt,
  }),
  seedRow(organizationCollection, reactionDids.actorA, 'self', {
    organizationType: ['nonprofit'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
  seedRow(profileCollection, reactionDids.actorB, 'self', {
    displayName: 'Reaction actor B',
    createdAt: indexedAt,
  }),
];

export const seedRows = await Promise.all([...likeRows, ...repostRows, ...sidecars]);
