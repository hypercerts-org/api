import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const accountFollow = 'app.certified.graph.follow';
const entityFollow = 'app.certified.graph.entityFollow';
const profile = 'app.certified.actor.profile';
const organization = 'app.certified.actor.organization';
const feature = 'org.hypercerts.entity.feature';
const indexedAt = '2025-03-01T00:00:00.000Z';
const tiedCreatedAt = '2025-02-10T00:00:00.000Z';

export const graphDids = {
  publisher: 'did:plc:mmmmmmmmmmmmmmmmmmmmmmmm',
  secondPublisher: 'did:plc:nnnnnnnnnnnnnnnnnnnnnnnn',
  primarySubject: 'did:plc:oooooooooooooooooooooooo',
  secondSubject: 'did:plc:pppppppppppppppppppppppp',
  thirdSubject: 'did:plc:qqqqqqqqqqqqqqqqqqqqqqqq',
  entityAuthor: 'did:plc:rrrrrrrrrrrrrrrrrrrrrrrr',
  curator: 'did:plc:ssssssssssssssssssssssss',
  thirdFollower: 'did:plc:tttttttttttttttttttttttt',
};

export const graphUris = {
  followedFeature: `at://${graphDids.entityAuthor}/${feature}/3jzfcijpj2z2a`,
  unresolvedFeature: `at://${graphDids.entityAuthor}/${feature}/3jzfcijpj2z2b`,
  secondFeature: `at://${graphDids.entityAuthor}/${feature}/3jzfcijpj2z2c`,
};

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

const accountFollows = [
  seedRow(accountFollow, graphDids.publisher, '3jzfcijpj2z2a', {
    subject: graphDids.primarySubject,
    createdAt: tiedCreatedAt,
    via: {
      uri: `at://${graphDids.curator}/app.certified.graph.list/3jzfcijpj2z2a`,
      cid: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
    },
  }),
  seedRow(accountFollow, graphDids.publisher, '3jzfcijpj2z2b', {
    subject: graphDids.primarySubject,
    createdAt: tiedCreatedAt,
  }),
  seedRow(accountFollow, graphDids.publisher, '3jzfcijpj2z2c', {
    subject: graphDids.secondSubject,
    createdAt: tiedCreatedAt,
  }),
  seedRow(accountFollow, graphDids.publisher, '3jzfcijpj2z2d', {
    subject: graphDids.thirdSubject,
    createdAt: tiedCreatedAt,
  }),
  seedRow(accountFollow, graphDids.secondPublisher, '3jzfcijpj2z2e', {
    subject: graphDids.primarySubject,
    createdAt: tiedCreatedAt,
  }),
  seedRow(accountFollow, graphDids.secondPublisher, '3jzfcijpj2z2f', {
    subject: graphDids.primarySubject,
    createdAt: '2025-02-09T00:00:00.000Z',
  }),
  seedRow(accountFollow, graphDids.thirdFollower, '3jzfcijpj2z2g', {
    subject: graphDids.primarySubject,
    createdAt: tiedCreatedAt,
  }),
];

const entityFollows = [
  seedRow(entityFollow, graphDids.publisher, '3jzfcijpj2z2a', {
    subject: { $type: 'app.certified.defs#recordSubject', uri: graphUris.followedFeature },
    createdAt: tiedCreatedAt,
  }),
  seedRow(entityFollow, graphDids.publisher, '3jzfcijpj2z2b', {
    subject: { $type: 'app.certified.defs#recordSubject', uri: graphUris.followedFeature },
    createdAt: tiedCreatedAt,
  }),
  seedRow(entityFollow, graphDids.publisher, '3jzfcijpj2z2c', {
    subject: { $type: 'app.certified.defs#recordSubject', uri: graphUris.unresolvedFeature },
    createdAt: tiedCreatedAt,
  }),
  seedRow(entityFollow, graphDids.publisher, '3jzfcijpj2z2d', {
    subject: { $type: 'app.certified.defs#recordSubject', uri: graphUris.secondFeature },
    createdAt: tiedCreatedAt,
  }),
  seedRow(entityFollow, graphDids.secondPublisher, '3jzfcijpj2z2e', {
    subject: { $type: 'app.certified.defs#recordSubject', uri: graphUris.followedFeature },
    createdAt: tiedCreatedAt,
  }),
  seedRow(entityFollow, graphDids.thirdFollower, '3jzfcijpj2z2f', {
    subject: { $type: 'app.certified.defs#recordSubject', uri: graphUris.followedFeature },
    createdAt: tiedCreatedAt,
  }),
];

const actorSidecars = [
  seedRow(profile, graphDids.publisher, 'self', {
    displayName: 'Graph Fixture Publisher',
    createdAt: indexedAt,
  }),
  seedRow(organization, graphDids.publisher, 'self', {
    organizationType: ['nonprofit'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
  seedRow(profile, graphDids.primarySubject, 'self', {
    displayName: 'Primary Graph Subject',
    createdAt: indexedAt,
  }),
  seedRow(organization, graphDids.primarySubject, 'self', {
    organizationType: ['cooperative'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
  seedRow(profile, graphDids.secondSubject, 'self', {
    displayName: 'Second Graph Subject',
    createdAt: indexedAt,
  }),
  seedRow(profile, graphDids.entityAuthor, 'self', {
    displayName: 'Graph Feature Author',
    createdAt: indexedAt,
  }),
];

const features = [
  seedRow(feature, graphDids.entityAuthor, '3jzfcijpj2z2a', {
    title: 'Protected forest corridor',
    createdAt: tiedCreatedAt,
    locations: [],
    tags: [],
    sameAs: ['https://example.test/forest-corridor'],
  }),
  seedRow(feature, graphDids.entityAuthor, '3jzfcijpj2z2c', {
    title: 'Community watershed',
    createdAt: tiedCreatedAt,
    locations: [],
    tags: [],
    sameAs: ['https://example.test/watershed'],
  }),
];

export const seedRows = await Promise.all([
  ...accountFollows,
  ...entityFollows,
  ...actorSidecars,
  ...features,
]);
