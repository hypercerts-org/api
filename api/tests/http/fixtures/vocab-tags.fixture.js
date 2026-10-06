import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const tagCollection = 'org.hypercerts.vocab.tag';
const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const primaryAuthor = 'did:web:vocab-author-a.example';
const secondaryAuthor = 'did:web:vocab-author-b.example';
const nullSidecarAuthor = 'did:web:vocab-author-c.example';
const indexedAt = '2025-02-04T05:06:07.000Z';
const tiedCreatedAt = '2025-02-01T00:00:00.000Z';

const tagSpecs = [
  {
    did: primaryAuthor,
    rkey: 'climate.forest',
    record: {
      key: 'forest',
      name: 'Forest cover',
      category: 'climate',
      status: 'accepted',
      createdAt: tiedCreatedAt,
      description: 'Areas covered by forest vegetation.',
    },
  },
  {
    did: primaryAuthor,
    rkey: 'climate.water',
    record: {
      key: 'water',
      name: 'Freshwater',
      category: 'climate',
      status: 'accepted',
      createdAt: tiedCreatedAt,
      aliases: ['inland water'],
    },
  },
  {
    did: secondaryAuthor,
    rkey: 'climate.river',
    record: {
      key: 'river',
      name: 'River',
      category: 'climate',
      status: 'accepted',
      createdAt: tiedCreatedAt,
    },
  },
  {
    did: secondaryAuthor,
    rkey: 'climate.coast',
    record: {
      key: 'coast',
      name: 'Coast',
      category: 'climate',
      status: 'accepted',
      createdAt: '2025-02-02T00:00:00.000Z',
    },
  },
  {
    did: nullSidecarAuthor,
    rkey: 'climate.mangrove',
    record: {
      key: 'mangrove',
      name: 'Mangrove',
      category: 'climate',
      status: 'accepted',
      createdAt: '2025-02-03T00:00:00.000Z',
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
  ...tagSpecs.map(({ did, rkey, record }) => seedRow(tagCollection, did, rkey, record)),
  seedRow(profileCollection, primaryAuthor, 'self', {
    displayName: 'Vocabulary Publisher A',
    description: 'Publisher profile fixture for vocabulary-tag query coverage.',
    createdAt: indexedAt,
  }),
  seedRow(organizationCollection, primaryAuthor, 'self', {
    organizationType: ['nonprofit'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
]);
