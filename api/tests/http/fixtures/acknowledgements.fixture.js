import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const acknowledgementCollection = 'org.hypercerts.context.acknowledgement';
const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const publisher = 'did:plc:llllllllllllllllllllllll';
const secondPublisher = 'did:web:acknowledgements-secondary.example';
const thirdPublisher = 'did:web:acknowledgements-tertiary.example';
const subjectUri = 'at://did:plc:mmmmmmmmmmmmmmmmmmmmmmmm/org.hypercerts.claim.activity/ack-subject';
const secondSubjectUri = 'at://did:plc:nnnnnnnnnnnnnnnnnnnnnnnn/org.hypercerts.claim.activity/ack-subject-two';
const thirdSubjectUri = 'at://did:plc:qqqqqqqqqqqqqqqqqqqqqqqq/org.hypercerts.claim.activity/ack-subject-three';
const contextUri = 'at://did:plc:rrrrrrrrrrrrrrrrrrrrrrrr/org.hypercerts.collection/ack-context';
const indexedAt = '2025-03-04T05:06:07.000Z';
const subjectCid = 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const contextCid = 'bafyreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const acknowledgementSpecs = [
  {
    did: publisher,
    rkey: 'ack-one',
    subject: subjectUri,
    createdAt: '2025-03-03T00:00:00.000Z',
    comment: 'The subject is supported.',
  },
  {
    did: publisher,
    rkey: 'ack-middle-a',
    subject: secondSubjectUri,
    createdAt: '2025-03-04T00:00:00.000Z',
    comment: 'The second subject is supported.',
  },
  {
    did: secondPublisher,
    rkey: 'ack-middle-b',
    subject: subjectUri,
    createdAt: '2025-03-04T00:00:00.000Z',
    comment: 'The first subject is supported by another publisher.',
  },
  {
    did: secondPublisher,
    rkey: 'ack-late',
    subject: secondSubjectUri,
    createdAt: '2025-03-05T00:00:00.000Z',
    comment: 'A later acknowledgement.',
  },
  {
    did: thirdPublisher,
    rkey: 'ack-author-negative',
    subject: subjectUri,
    createdAt: '2025-03-06T00:00:00.000Z',
    comment: 'An acknowledgement outside the publisher filter.',
  },
  {
    did: publisher,
    rkey: 'ack-subject-negative',
    subject: thirdSubjectUri,
    createdAt: '2025-03-07T00:00:00.000Z',
    comment: 'An acknowledgement outside the subject filter.',
  },
];

const records = [
  ...acknowledgementSpecs.map(({ did, rkey, subject, createdAt, comment }) => ({
    did,
    collection: acknowledgementCollection,
    rkey,
    record: {
      $type: acknowledgementCollection,
      acknowledged: true,
      comment,
      subject: { uri: subject, cid: subjectCid },
      context: { uri: contextUri, cid: contextCid },
      createdAt,
    },
  })),
  {
    did: publisher,
    collection: profileCollection,
    rkey: 'self',
    record: { $type: profileCollection, displayName: 'Acknowledgement Publisher', createdAt: indexedAt },
  },
  {
    did: publisher,
    collection: organizationCollection,
    rkey: 'self',
    record: { $type: organizationCollection, organizationType: ['nonprofit'], createdAt: indexedAt },
  },
];

export const seedRows = await Promise.all(records.map(async ({ did, collection, rkey, record }) => ({
  uri: `at://${did}/${collection}/${rkey}`,
  did,
  collection,
  rkey,
  cid: CID.toString(await CID.create(0x71, encode(record))),
  indexedAt,
  record,
})));
