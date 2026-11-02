import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const contributorCollection = 'org.hypercerts.claim.contributorInformation';
const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const authorA = 'did:web:contributor-http-author-a.invalid';
const authorB = 'did:web:contributor-http-author-b.invalid';
const authorC = 'did:web:contributor-http-author-c.invalid';
const createdAt = '2025-03-01T00:00:00.000Z';
const indexedAt = '2025-03-02T00:00:00.000Z';

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
  seedRow(contributorCollection, authorA, '3jzfcijpj2z2a', {
    identifier: 'manual:cedar-restorer',
    displayName: 'Cedar Restorer',
    createdAt,
  }),
  seedRow(contributorCollection, authorB, '3jzfcijpj2z2b', {
    identifier: 'manual:river-monitor',
    displayName: 'River Monitor',
    createdAt,
  }),
  seedRow(contributorCollection, authorC, '3jzfcijpj2z2c', {
    identifier: 'manual:forest-keeper',
    displayName: 'Forest Keeper',
    createdAt,
  }),
  seedRow(profileCollection, authorA, 'self', {
    displayName: 'Cedar Watershed Group',
    createdAt: indexedAt,
  }),
  seedRow(organizationCollection, authorA, 'self', {
    organizationType: ['nonprofit'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
]);
