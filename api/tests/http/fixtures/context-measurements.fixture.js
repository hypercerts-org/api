import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
import { activityRecord, staleOnlyActivityRecord } from '../../fixtures/activities.js';

const collection = 'org.hypercerts.context.measurement';
const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const publisherA = 'did:plc:measurementhttpfixtureaa';
const publisherB = 'did:plc:nnnnnnnnnnnnnnnnnnnnnnnn';
const measurer = 'did:plc:oooooooooooooooooooooooo';
const indexedAt = '2025-03-01T00:00:00.000Z';
const tiedCreatedAt = '2025-02-01T00:00:00.000Z';

const measurementSpecs = [
  {
    did: publisherA,
    rkey: '3jzfcijpj2z2a',
    fields: {
      metric: 'trees planted',
      unit: 'tree',
      value: '00012.3400',
      createdAt: tiedCreatedAt,
      subjects: [{ uri: activityRecord.uri, cid: activityRecord.cid }],
      measurers: [{ did: measurer }],
    },
  },
  {
    did: publisherA,
    rkey: '3jzfcijpj2z2b',
    fields: {
      metric: 'water restored',
      unit: 'litre',
      value: '0.0000007',
      createdAt: tiedCreatedAt,
      subjects: [{ uri: staleOnlyActivityRecord.uri, cid: staleOnlyActivityRecord.cid }],
    },
  },
  {
    did: publisherA,
    rkey: '3jzfcijpj2z2c',
    fields: {
      metric: 'soil carbon',
      unit: 'tonne',
      value: '3.1',
      createdAt: tiedCreatedAt,
    },
  },
  {
    did: publisherB,
    rkey: '3jzfcijpj2z2d',
    fields: {
      metric: 'canopy cover',
      unit: 'percent',
      value: '56.2',
      createdAt: '2025-02-02T00:00:00.000Z',
      subjects: [{ uri: activityRecord.uri, cid: activityRecord.cid }],
    },
  },
];

async function seedRow(collectionName, did, rkey, fields) {
  const record = { $type: collectionName, ...fields };
  return {
    uri: `at://${did}/${collectionName}/${rkey}`,
    did,
    collection: collectionName,
    rkey,
    cid: CID.toString(await CID.create(0x71, encode(record))),
    indexedAt,
    record,
  };
}

export const seedRows = await Promise.all([
  ...measurementSpecs.map(({ did, rkey, fields }) => seedRow(collection, did, rkey, fields)),
  seedRow(profileCollection, publisherA, 'self', {
    displayName: 'Measurement Publisher',
    createdAt: indexedAt,
  }),
  seedRow(organizationCollection, publisherA, 'self', {
    organizationType: ['nonprofit'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
]);
