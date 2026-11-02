import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const COLLECTION = 'org.hypercerts.collection';
const TAG = 'org.hypercerts.vocab.tag';
const ACTIVITY = 'org.hypercerts.claim.activity';
const FEATURE = 'org.hypercerts.entity.feature';
const LOCATION = 'app.certified.location';
const PROFILE = 'app.certified.actor.profile';
const ORGANIZATION = 'app.certified.actor.organization';
const authorA = 'did:web:collections-author-a.example';
const authorB = 'did:web:collections-author-b.example';
const createdAt = '2025-03-01T00:00:00.000Z';
const indexedAt = '2025-03-02T03:04:05.000Z';

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

function strongRef(row) {
  return { $type: 'com.atproto.repo.strongRef', uri: row.uri, cid: row.cid };
}

const [mangroveTag, restorationTag, location, activity, feature, profile, organization] = await Promise.all([
  seedRow(TAG, authorA, 'ecosystem-type.mangrove', {
    key: 'mangrove', name: 'Mangrove', category: 'ecosystem-type', status: 'accepted', createdAt,
  }),
  seedRow(TAG, authorA, 'outcome-class.restoration', {
    key: 'restoration', name: 'Restoration', category: 'outcome-class', status: 'accepted', createdAt,
  }),
  seedRow(LOCATION, authorA, '3jzfcijpj2z2a', {
    lpVersion: '1.0.0',
    srs: 'https://www.opengis.net/def/crs/OGC/1.3/CRS84',
    locationType: 'geojson-point',
    location: { $type: 'app.certified.location#string', string: '{"type":"Point","coordinates":[89.64,27.47]}' },
    name: 'Southern mangrove reserve',
    createdAt,
  }),
  seedRow(ACTIVITY, authorB, '3jzfcijpj2z2b', {
    title: 'Community mangrove planting',
    shortDescription: 'Restoration work along the southern estuary.',
    createdAt,
  }),
  seedRow(FEATURE, authorB, 'feature-restoration-zone', {
    type: 'zone', title: 'Estuary restoration zone', createdAt,
  }),
  seedRow(PROFILE, authorA, 'self', {
    displayName: 'Collections Research Group', createdAt,
  }),
  seedRow(ORGANIZATION, authorB, 'self', {
    organizationType: ['community'], createdAt,
  }),
]);

const riverProgram = await seedRow(COLLECTION, authorB, '3jzfcijpj2z2d', {
  type: 'program',
  title: 'River monitoring program',
  shortDescription: 'Community river monitoring.',
  createdAt,
  items: [],
});

const mainCollection = await seedRow(COLLECTION, authorA, '3jzfcijpj2z2a', {
  type: 'project',
  title: 'Mangrove restoration portfolio',
  shortDescription: 'Coastal restoration monitoring.',
  createdAt,
  location: strongRef(location),
  tags: [
    strongRef(mangroveTag),
    strongRef(restorationTag),
    { ...strongRef(mangroveTag), cid: restorationTag.cid },
  ],
  items: [
    { itemIdentifier: strongRef(activity), itemWeight: '1' },
    { itemIdentifier: strongRef(feature), itemWeight: '2' },
    { itemIdentifier: strongRef(riverProgram), itemWeight: '3' },
    { itemIdentifier: { ...strongRef(activity), cid: feature.cid }, itemWeight: '4' },
  ],
});

const overviewCollection = await seedRow(COLLECTION, authorA, '3jzfcijpj2z2b', {
  type: 'project',
  title: 'Mangrove restoration overview',
  shortDescription: 'A summary of restoration work.',
  createdAt,
  tags: [strongRef(mangroveTag)],
  items: [],
});

const watershedProject = await seedRow(COLLECTION, authorA, '3jzfcijpj2z2c', {
  type: 'project',
  title: 'Watershed restoration project',
  shortDescription: 'Restoration planning for local watersheds.',
  createdAt,
  tags: [strongRef(restorationTag)],
  items: [],
});

export const collectionFixtures = {
  authorA,
  authorB,
  mainCollection,
  overviewCollection,
  watershedProject,
  riverProgram,
  mangroveTag,
  restorationTag,
  location,
  activity,
  feature,
};

export const seedRows = [
  mangroveTag,
  restorationTag,
  location,
  activity,
  feature,
  profile,
  organization,
  mainCollection,
  overviewCollection,
  watershedProject,
  riverProgram,
];
