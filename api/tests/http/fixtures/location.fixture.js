import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
import { badDateLocations } from '../../fixtures/bad-location-dates.js';

const collections = {
  location: 'app.certified.location',
  profile: 'app.certified.actor.profile',
  organization: 'app.certified.actor.organization',
};

export const locationAuthorDid = 'did:web:location-http-publisher.invalid';
export const noRelationsDid = 'did:web:location-no-relations.example';
export const profileOnlyDid = 'did:web:location-profile-only.example';
export const organizationOnlyDid = 'did:web:location-organization-only.example';
const indexedAt = '2025-02-01T00:00:00.000Z';

async function row(collection, did, rkey, fields) {
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

export const locationRecords = await Promise.all([
  row(collections.location, locationAuthorDid, '3jzfcijpj2z2a', {
    lpVersion: '1.0.0', srs: 'https://www.opengis.net/def/crs/OGC/1.3/CRS84', locationType: 'geojson',
    location: { $type: 'app.certified.location#string', string: '{"type":"Point","coordinates":[89.64,27.47]}' },
    name: 'Thimphu Forest', createdAt: '2025-01-01T00:00:00.000Z',
  }),
  row(collections.location, locationAuthorDid, '3jzfcijpj2z2b', {
    lpVersion: '1.0.0', srs: 'https://www.opengis.net/def/crs/OGC/1.3/CRS84', locationType: 'address',
    location: { $type: 'app.certified.location#string', string: 'Wang Chhu riverbank' },
    name: 'Wang Chhu Riverbank', description: 'Urban river monitoring site', createdAt: '2025-01-02T00:00:00.000Z',
  }),
  row(collections.location, locationAuthorDid, '3jzfcijpj2z2c', {
    lpVersion: '1.0.0', srs: 'https://www.opengis.net/def/crs/OGC/1.3/CRS84', locationType: 'geojson',
    location: {
      $type: 'org.hypercerts.defs#smallBlob',
      blob: {
        $type: 'blob',
        ref: { $link: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy' },
        mimeType: 'application/geo+json',
        size: 68,
      },
    },
    name: 'Blob-backed test location',
    description: 'Synthetic blob reference for record-shape and API pass-through tests; blob bytes are not included.',
    createdAt: '2025-01-03T00:00:00.000Z',
  }),
  row(collections.location, locationAuthorDid, '3jzfcijpj2z2d', {
    lpVersion: '1.0.0', srs: 'https://www.opengis.net/def/crs/OGC/1.3/CRS84', locationType: '',
    location: { $type: 'app.certified.location#string', string: 'Empty location type fixture' },
    name: 'Empty location type fixture', createdAt: '2025-01-04T00:00:00+01:00',
  }),
  row(collections.location, noRelationsDid, '3jzfcijpj2z2e', {
    lpVersion: '1.0.0', srs: 'https://www.opengis.net/def/crs/OGC/1.3/CRS84', locationType: 'geojson-point',
    location: { $type: 'app.certified.location#string', string: 'No linked author records' },
    name: 'Unhydrated author', createdAt: '2025-01-04T00:00:00Z',
  }),
  row(collections.location, profileOnlyDid, '3jzfcijpj2z2f', {
    lpVersion: '1.0.0', srs: 'https://www.opengis.net/def/crs/OGC/1.3/CRS84', locationType: 'geojson',
    location: { $type: 'app.certified.location#string', string: 'Profile without organization' },
    name: 'Profile-only author', createdAt: '2025-01-05T00:00:00Z',
  }),
  row(collections.location, organizationOnlyDid, '3jzfcijpj2z2g', {
    lpVersion: '1.0.0', srs: 'https://www.opengis.net/def/crs/OGC/1.3/CRS84', locationType: 'geojson',
    location: { $type: 'app.certified.location#string', string: 'Organization without profile' },
    name: 'Organization-only author', createdAt: '2025-01-06T00:00:00Z',
  }),
]);

export const profileRecords = await Promise.all([
  row(collections.profile, locationAuthorDid, 'self', {
    displayName: 'Location Fixture Publisher', description: 'Deterministic location API fixture', createdAt: indexedAt,
  }),
  row(collections.profile, profileOnlyDid, 'self', {
    displayName: 'Profile-only location publisher', createdAt: indexedAt,
  }),
]);

export const organizationRecords = await Promise.all([
  row(collections.organization, locationAuthorDid, 'self', {
    organizationType: ['nonprofit'], visibility: 'public', createdAt: indexedAt,
  }),
  row(collections.organization, organizationOnlyDid, 'self', {
    organizationType: ['community'], createdAt: indexedAt,
  }),
]);

export { badDateLocations };

// The shared HTTP seeder maps indexedAt to NOT NULL created_at; preserve the intended stored-time fallback for unindexed rows.
const badDateSeedRows = badDateLocations.map(({ storedAt, ...badDateRow }) => ({
  ...badDateRow,
  indexedAt: badDateRow.indexedAt ?? storedAt,
}));

export const seedRows = [
  ...locationRecords,
  ...profileRecords,
  ...organizationRecords,
  ...badDateSeedRows,
];
