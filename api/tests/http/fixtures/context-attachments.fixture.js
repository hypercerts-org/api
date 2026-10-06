import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const attachmentCollection = 'org.hypercerts.context.attachment';
const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const publisherA = 'did:web:context-attachment-a.invalid';
const publisherB = 'did:web:context-attachment-b.invalid';
const publisherC = 'did:web:context-attachment-c.invalid';
const subjectA = 'at://did:web:context-subject-a.invalid/org.hypercerts.claim.activity/subject-a';
const subjectB = 'at://did:web:context-subject-b.invalid/org.hypercerts.claim.activity/subject-b';
const subjectC = 'at://did:web:context-subject-c.invalid/org.hypercerts.claim.activity/subject-c';
const subjectCid = 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const indexedAt = '2025-03-04T05:06:07.000Z';
const tiedCreatedAt = '2025-03-01T00:00:00.000Z';

const attachmentSpecs = [
  {
    did: publisherA,
    rkey: '3jzfcijpj2z2a',
    record: {
      title: 'Evidence attachment A',
      createdAt: tiedCreatedAt,
      contentType: 'evidence',
      subjects: [{ uri: subjectA, cid: subjectCid }],
      content: [{ $type: 'org.hypercerts.defs#uri', uri: 'https://example.test/context/a.pdf' }],
    },
  },
  {
    did: publisherA,
    rkey: '3jzfcijpj2z2b',
    record: {
      title: 'Document attachment B',
      createdAt: tiedCreatedAt,
      contentType: 'document',
      subjects: [{ uri: subjectB, cid: subjectCid }],
      content: [{ $type: 'org.hypercerts.defs#uri', uri: 'https://example.test/context/b.pdf' }],
    },
  },
  {
    did: publisherB,
    rkey: '3jzfcijpj2z2c',
    record: {
      title: 'Evidence attachment C',
      createdAt: tiedCreatedAt,
      contentType: 'evidence',
      subjects: [{ uri: subjectB, cid: subjectCid }],
      content: [{ $type: 'org.hypercerts.defs#uri', uri: 'https://example.test/context/c.pdf' }],
    },
  },
  {
    did: publisherC,
    rkey: '3jzfcijpj2z2d',
    record: {
      title: 'Audio attachment D',
      createdAt: '2025-03-02T00:00:00.000Z',
      contentType: 'audio',
      subjects: [{ uri: subjectC, cid: subjectCid }],
      content: [{ $type: 'org.hypercerts.defs#uri', uri: 'https://example.test/context/d.mp3' }],
    },
  },
];

async function seedRow(collection, did, rkey, fields) {
  const record = { $type: collection, ...fields };
  return {
    uri: `at://${did}/${collection}/${rkey}`,
    did,
    collection,
    rkey,
    cid: CID.toString(await CID.create(0x71, encode(record))),
    indexedAt,
    record,
  };
}

export const seedRows = await Promise.all([
  ...attachmentSpecs.map(({ did, rkey, record }) => seedRow(attachmentCollection, did, rkey, record)),
  seedRow(profileCollection, publisherA, 'self', {
    displayName: 'Context attachment publisher',
    createdAt: indexedAt,
  }),
  seedRow(organizationCollection, publisherB, 'self', {
    organizationType: ['nonprofit'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
]);
