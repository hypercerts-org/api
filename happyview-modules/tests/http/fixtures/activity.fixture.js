import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const ACTIVITY = 'org.hypercerts.claim.activity';
const PROFILE = 'app.certified.actor.profile';
const ORGANIZATION = 'app.certified.actor.organization';
const authorDid = 'did:web:activity-http-author.invalid';
const otherAuthorDid = 'did:web:activity-http-other-author.invalid';
const contributorDid = 'did:web:activity-http-contributor.invalid';
const profilelessContributorDid = 'did:web:activity-http-profileless-contributor.invalid';
const indexedAt = '2025-01-02T03:04:05.000Z';
const tiedCreatedAt = '2025-02-01T00:00:00Z';

const activitySpecs = [
  {
    rkey: '3jzfcijpj2z2a',
    record: {
      title: 'River restoration %_ fixture',
      shortDescription: 'A literal search phrase for the activity HTTP endpoint.',
      createdAt: tiedCreatedAt,
      contributors: [
        { contributorIdentity: { $type: 'org.hypercerts.claim.activity#contributorIdentity', identity: contributorDid }, contributionWeight: '1' },
        { contributorIdentity: { $type: 'org.hypercerts.claim.activity#contributorIdentity', identity: profilelessContributorDid }, contributionWeight: '2' },
        { contributorIdentity: { $type: 'org.hypercerts.claim.activity#contributorIdentity', identity: 'https://example.org/external-contributor' }, contributionWeight: '3' },
      ],
    },
  },
  {
    rkey: '3jzfcijpj2z2b',
    record: { title: 'Wetland restoration', shortDescription: 'A tied activity row.', createdAt: tiedCreatedAt },
  },
  {
    rkey: '3jzfcijpj2z2c',
    record: { title: 'Community monitoring', shortDescription: 'Another tied activity row.', createdAt: tiedCreatedAt },
  },
  {
    rkey: '3jzfcijpj2z2d',
    record: { title: 'Urban stream care', shortDescription: 'The final row at the tied timestamp.', createdAt: tiedCreatedAt },
  },
  {
    rkey: '3jzfcijpj2z2e',
    record: { title: 'Later watershed work', shortDescription: 'A later activity row.', createdAt: '2025-02-02T00:00:00Z' },
  },
  {
    rkey: '3jzfcijpj2z2f',
    record: { title: 'River restoration by communities', shortDescription: 'This row matches only when wildcards are interpreted.', createdAt: '2025-02-03T00:00:00Z' },
  },
];

async function row(collection, did, rkey, fields) {
  const record = { $type: collection, ...fields };
  const uri = `at://${did}/${collection}/${rkey}`;
  return {
    uri,
    did,
    collection,
    rkey,
    cid: CID.toString(await CID.create(0x71, encode(record))),
    indexedAt,
    record,
  };
}

export const seedRows = await Promise.all([
  ...activitySpecs.map(({ rkey, record }) => row(ACTIVITY, authorDid, rkey, record)),
  row(ACTIVITY, otherAuthorDid, '3jzfcijpj2z2a', {
    title: 'River restoration %_ from another author',
    shortDescription: 'An exact literal match that must fail the author filter.',
    createdAt: '2025-02-01T00:00:00Z',
  }),
  row(PROFILE, authorDid, 'self', {
    displayName: 'Activity HTTP author',
    createdAt: indexedAt,
  }),
  row(ORGANIZATION, authorDid, 'self', {
    organizationType: ['nonprofit'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
  row(PROFILE, contributorDid, 'self', {
    displayName: 'Activity HTTP contributor',
    createdAt: indexedAt,
  }),
]);
