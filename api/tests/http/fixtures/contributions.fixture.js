import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const contributionCollection = 'org.hypercerts.claim.contribution';
const profileCollection = 'app.certified.actor.profile';
const publishers = {
  a: 'did:web:contribution-a.invalid',
  b: 'did:web:contribution-b.invalid',
  c: 'did:web:contribution-c.invalid',
};
const indexedAt = '2025-04-01T00:00:00.000Z';

const contributions = [
  {
    did: publishers.a,
    rkey: 'alpha',
    record: {
      $type: contributionCollection,
      role: 'Survey lead',
      contributionDescription: 'Mapped riverbank vegetation.',
      createdAt: '2025-03-01T00:00:00Z',
    },
  },
  {
    did: publishers.a,
    rkey: 'beta',
    record: {
      $type: contributionCollection,
      role: 'Data reviewer',
      contributionDescription: 'Reviewed the field measurements.',
      createdAt: '2025-03-01T00:00:00Z',
    },
  },
  {
    did: publishers.b,
    rkey: 'gamma',
    record: {
      $type: contributionCollection,
      role: 'Sample collector',
      contributionDescription: 'Collected water samples.',
      createdAt: '2025-03-01T00:00:00Z',
    },
  },
  {
    did: publishers.b,
    rkey: 'delta',
    record: {
      $type: contributionCollection,
      role: 'Archive curator',
      contributionDescription: 'Catalogued historical survey data.',
      createdAt: '2025-02-01T00:00:00Z',
    },
  },
  {
    did: publishers.c,
    rkey: 'epsilon',
    record: {
      $type: contributionCollection,
      role: 'Community liaison',
      contributionDescription: 'Coordinated local review sessions.',
      createdAt: '2025-01-01T00:00:00Z',
    },
  },
];

async function seedRow({ did, collection, rkey, record }) {
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

const contributionRows = await Promise.all(contributions.map((entry) => seedRow({
  ...entry,
  collection: contributionCollection,
})));
const publisherProfile = await seedRow({
  did: publishers.a,
  collection: profileCollection,
  rkey: 'self',
  record: {
    $type: profileCollection,
    displayName: 'River Survey Publisher',
    createdAt: '2025-01-15T00:00:00Z',
  },
});

export const seedRows = [...contributionRows, publisherProfile];
