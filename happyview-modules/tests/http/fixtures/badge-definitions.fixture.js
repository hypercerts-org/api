import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const badgeCollection = 'app.certified.badge.definition';
const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const publisherA = 'did:plc:iiiiiiiiiiiiiiiiiiiiiiii';
const publisherB = 'did:plc:jjjjjjjjjjjjjjjjjjjjjjjj';
const outsidePublisher = 'did:plc:kkkkkkkkkkkkkkkkkkkkkkkk';
const allowedIssuer = 'did:plc:dddddddddddddddddddddddd';
const indexedAt = '2025-02-03T04:05:06.000Z';
const tiedCreatedAt = '2025-02-01T00:00:00.000Z';
const iconCid = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy';

const badgeDefinitions = [
  {
    did: publisherA,
    rkey: '3jzfcijpj2z2a',
    record: {
      title: 'River restoration certification',
      badgeType: 'certification',
      createdAt: tiedCreatedAt,
      description: 'Recognizes verified river restoration outcomes.',
      icon: {
        $type: 'blob',
        ref: { $link: iconCid },
        mimeType: 'image/png',
        size: 32768,
      },
      allowedIssuers: [{ did: allowedIssuer }],
    },
  },
  {
    did: publisherA,
    rkey: '3jzfcijpj2z2b',
    record: {
      title: 'Community watershed recognition',
      badgeType: 'recognition',
      createdAt: tiedCreatedAt,
      allowedIssuers: [{ did: publisherB }],
    },
  },
  {
    did: publisherB,
    rkey: '3jzfcijpj2z2c',
    record: {
      title: 'Community monitoring certification',
      badgeType: 'certification',
      createdAt: tiedCreatedAt,
    },
  },
  {
    did: outsidePublisher,
    rkey: '3jzfcijpj2z2d',
    record: {
      title: 'Independent watershed recognition',
      badgeType: 'recognition',
      createdAt: tiedCreatedAt,
    },
  },
  {
    did: publisherA,
    rkey: '3jzfcijpj2z2e',
    record: {
      title: 'Watershed volunteer participation',
      badgeType: 'participation',
      createdAt: '2025-02-02T00:00:00.000Z',
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
  ...badgeDefinitions.map(({ did, rkey, record }) => seedRow(badgeCollection, did, rkey, record)),
  seedRow(profileCollection, publisherA, 'self', {
    displayName: 'River Stewardship Alliance',
    description: 'Regional watershed restoration and monitoring.',
    createdAt: indexedAt,
  }),
  seedRow(organizationCollection, publisherB, 'self', {
    organizationType: ['nonprofit', 'cooperative'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
]);
