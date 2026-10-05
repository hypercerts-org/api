import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const featureCollection = 'org.hypercerts.entity.feature';
const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const featureAuthor = 'did:plc:xxxxxxxxxxxxxxxxxxxxxxxx';
const profileOnlyAuthor = 'did:plc:yyyyyyyyyyyyyyyyyyyyyyyy';
const unhydratedAuthor = 'did:plc:zzzzzzzzzzzzzzzzzzzzzzzz';
const indexedAt = '2025-03-03T04:05:06.000Z';

const features = [
  {
    did: profileOnlyAuthor,
    rkey: 'feature-bog',
    record: {
      type: 'bog',
      title: 'Restored peatland',
      createdAt: '2025-02-27T00:00:00.000Z',
      locations: [],
      tags: [],
      sameAs: [],
    },
  },
  {
    did: profileOnlyAuthor,
    rkey: 'feature-older',
    record: {
      type: 'forest',
      title: 'Older canopy',
      createdAt: '2025-02-28T00:00:00.000Z',
      locations: [],
      tags: [],
      sameAs: [],
    },
  },
  {
    did: featureAuthor,
    rkey: 'feature-alpha',
    record: {
      type: 'wetland',
      title: 'Wang Chhu floodplain',
      createdAt: '2025-03-01T00:00:00.000Z',
      locations: [],
      tags: [],
      sameAs: [],
    },
  },
  {
    did: featureAuthor,
    rkey: 'feature-beta',
    record: {
      type: 'wetland',
      title: 'Northern marsh',
      createdAt: '2025-03-01T00:00:00.000Z',
      locations: [],
      tags: [],
      sameAs: [],
    },
  },
  {
    did: profileOnlyAuthor,
    rkey: 'feature-gamma',
    record: {
      type: 'wetland',
      title: 'Community wetland',
      createdAt: '2025-03-01T00:00:00.000Z',
      locations: [],
      tags: [],
      sameAs: [],
    },
  },
  {
    did: unhydratedAuthor,
    rkey: 'feature-newer',
    record: {
      type: 'wetland',
      title: 'New growth',
      createdAt: '2025-03-02T00:00:00.000Z',
      locations: [],
      tags: [],
      sameAs: [],
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
  ...features.map(({ did, rkey, record }) => seedRow(featureCollection, did, rkey, record)),
  seedRow(profileCollection, featureAuthor, 'self', {
    displayName: 'River Stewardship Alliance',
    description: 'Community wetland monitoring and restoration.',
    createdAt: indexedAt,
  }),
  seedRow(organizationCollection, featureAuthor, 'self', {
    organizationType: ['community'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
  seedRow(profileCollection, profileOnlyAuthor, 'self', {
    displayName: 'Forest Stewards',
    createdAt: indexedAt,
  }),
]);
