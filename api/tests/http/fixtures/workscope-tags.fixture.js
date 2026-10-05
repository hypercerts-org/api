import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const workscopeTag = 'org.hypercerts.workscope.tag';
const profile = 'app.certified.actor.profile';
const organization = 'app.certified.actor.organization';
const publisherA = 'did:web:workscope-a.example';
const publisherB = 'did:web:workscope-b.example';
const publisherC = 'did:web:workscope-c.example';
const indexedAt = '2025-03-10T12:00:00.000Z';

const tagSpecs = [
  {
    did: publisherA,
    rkey: 'tag-tie-a',
    record: { key: 'shared_key', name: 'Shared key from A', createdAt: '2025-03-01T00:00:00Z' },
  },
  {
    did: publisherA,
    rkey: 'tag-tie-z',
    record: { key: 'shared_key', name: 'Shared key from A, later URI', createdAt: '2025-03-01T00:00:00Z' },
  },
  {
    did: publisherB,
    rkey: 'tag-tie-b',
    record: { key: 'shared_key', name: 'Shared key from B', createdAt: '2025-03-01T00:00:00Z' },
  },
  {
    did: publisherA,
    rkey: 'tag-older',
    record: { key: 'older_key', name: 'Older tag', createdAt: '2025-02-28T00:00:00Z' },
  },
  {
    did: publisherA,
    rkey: 'tag-unknown-offset',
    indexedAt: '2025-02-28T12:00:00.000Z',
    record: { key: 'unknown_offset_key', name: 'Unknown offset timestamp', createdAt: '2025-03-02T00:00:00-00:00' },
  },
  {
    did: publisherC,
    rkey: 'tag-filter-c',
    record: { key: 'filter_key', name: 'Filter-only tag from C', createdAt: '2025-03-02T00:00:00Z' },
  },
];

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

export const seedRows = await Promise.all([
  ...tagSpecs.map(({ did, rkey, record, indexedAt: rowIndexedAt }) => seedRow(workscopeTag, did, rkey, record, rowIndexedAt)),
  seedRow(profile, publisherA, 'self', {
    displayName: 'Workscope Test Publisher',
    description: 'Publisher profile for workscope-tag HTTP contracts.',
    createdAt: indexedAt,
  }),
  seedRow(organization, publisherA, 'self', {
    organizationType: ['community'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
]);
