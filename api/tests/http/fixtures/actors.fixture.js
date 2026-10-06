import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const createdAt = '2025-02-01T00:00:00.000Z';
const indexedAt = '2025-03-03T04:05:06.000Z';

export const actorFixtureDids = {
  alpine: 'did:plc:mmmmmmmmmmmmmmmmmmmmmmmm',
  forest: 'did:plc:nnnnnnnnnnnnnnnnnnnnnnnn',
  river: 'did:plc:oooooooooooooooooooooooo',
  profileOnly: 'did:plc:pppppppppppppppppppppppp',
  organizationOnly: 'did:plc:qqqqqqqqqqqqqqqqqqqqqqqq',
};

const records = [
  {
    did: actorFixtureDids.alpine,
    collection: profileCollection,
    rkey: 'self',
    record: {
      displayName: 'Alpine Forest Consortium',
      description: 'Forest restoration and mountain ecosystem monitoring.',
      createdAt,
    },
  },
  {
    did: actorFixtureDids.forest,
    collection: profileCollection,
    rkey: 'self',
    record: {
      displayName: 'Forest %_ Commons',
      description: 'Community-led watershed restoration.',
      createdAt,
    },
  },
  {
    did: actorFixtureDids.river,
    collection: profileCollection,
    rkey: 'self',
    record: {
      displayName: 'River Observatory',
      description: 'Forest and river monitoring data.',
      createdAt,
    },
  },
  {
    did: actorFixtureDids.profileOnly,
    collection: profileCollection,
    rkey: 'self',
    record: {
      displayName: 'Profile-only Research Group',
      description: 'A profile without an organization sidecar.',
      createdAt,
    },
  },
  {
    did: actorFixtureDids.alpine,
    collection: organizationCollection,
    rkey: 'self',
    record: {
      organizationType: ['nonprofit', 'cooperative'],
      visibility: 'public',
      createdAt,
    },
  },
  {
    did: actorFixtureDids.forest,
    collection: organizationCollection,
    rkey: 'self',
    record: {
      organizationType: ['community'],
      visibility: 'unlisted',
      createdAt,
    },
  },
  {
    did: actorFixtureDids.river,
    collection: organizationCollection,
    rkey: 'self',
    record: {
      organizationType: ['nonprofit'],
      visibility: 'public',
      createdAt,
    },
  },
  {
    did: actorFixtureDids.organizationOnly,
    collection: organizationCollection,
    rkey: 'self',
    record: {
      organizationType: ['community'],
      createdAt,
    },
  },
];

export const seedRows = await Promise.all(records.map(async ({ did, collection, rkey, record, indexedAt: rowIndexedAt = indexedAt }) => {
  const storedRecord = { $type: collection, ...record };
  return {
    uri: `at://${did}/${collection}/${rkey}`,
    did,
    collection,
    rkey,
    cid: CID.toString(await CID.create(0x71, encode(storedRecord))),
    indexedAt: rowIndexedAt,
    record: storedRecord,
  };
}));
