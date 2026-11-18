import { encode } from "@atcute/cbor";
import * as CID from "@atcute/cid";

const accountFollow = "app.certified.graph.follow";
const entityFollow = "app.certified.graph.entityFollow";
const profile = "app.certified.actor.profile";
const organization = "app.certified.actor.organization";
const feature = "org.hypercerts.entity.feature";
const indexedAt = "2025-03-01T00:00:00.000Z";
const tiedCreatedAt = "2025-02-10T00:00:00.000Z";

export const graphDids = {
  publisher: "did:plc:uuuuuuuuuuuuuuuuuuuuuuuu",
  secondPublisher: "did:plc:vvvvvvvvvvvvvvvvvvvvvvvv",
  primarySubject: "did:plc:wwwwwwwwwwwwwwwwwwwwwwww",
  secondSubject: "did:plc:xxxxxxxxxxxxxxxxxxxxxxxx",
  thirdSubject: "did:plc:666666666666666666666666",
  entityAuthor: "did:plc:rrrrrrrrrrrrrrrrrrrrrrrr",
  curator: "did:plc:ssssssssssssssssssssssss",
  thirdFollower: "did:plc:tttttttttttttttttttttttt",
  // Legacy project-follow scenario: an org whose own collection was used as `via`.
  legacyOrg: "did:plc:111111111111111111111111",
  legacyOnly: "did:plc:222222222222222222222222",
  legacyThenPlain: "did:plc:333333333333333333333333",
  legitViaOtherCollection: "did:plc:444444444444444444444444",
  legitViaStarterPack: "did:plc:555555555555555555555555",
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
  seedRow(accountFollow, graphDids.publisher, "3jzfcijpj2z2a", {
    subject: graphDids.primarySubject,
    createdAt: tiedCreatedAt,
    via: {
      uri: `at://${graphDids.curator}/app.certified.graph.list/3jzfcijpj2z2a`,
      cid: "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy",
    },
  }),
  seedRow(accountFollow, graphDids.publisher, "3jzfcijpj2z2b", {
    subject: graphDids.primarySubject,
    createdAt: tiedCreatedAt,
  }),
  seedRow(accountFollow, graphDids.publisher, "3jzfcijpj2z2c", {
    subject: graphDids.secondSubject,
    createdAt: tiedCreatedAt,
  }),
  seedRow(accountFollow, graphDids.publisher, "3jzfcijpj2z2d", {
    subject: graphDids.thirdSubject,
    createdAt: tiedCreatedAt,
  }),
  seedRow(accountFollow, graphDids.secondPublisher, "3jzfcijpj2z2e", {
    subject: graphDids.primarySubject,
    createdAt: tiedCreatedAt,
  }),
  seedRow(accountFollow, graphDids.secondPublisher, "3jzfcijpj2z2f", {
    subject: graphDids.primarySubject,
    createdAt: "2025-02-09T00:00:00.000Z",
  }),
  seedRow(accountFollow, graphDids.thirdFollower, "3jzfcijpj2z2g", {
    subject: graphDids.primarySubject,
    createdAt: tiedCreatedAt,
  }),
];

const entityFollows = [
  seedRow(entityFollow, graphDids.publisher, "3jzfcijpj2z2a", {
    subject: { $type: "app.certified.defs#recordSubject", uri: graphUris.followedFeature },
    createdAt: tiedCreatedAt,
  }),
  seedRow(entityFollow, graphDids.publisher, "3jzfcijpj2z2b", {
    subject: { $type: "app.certified.defs#recordSubject", uri: graphUris.followedFeature },
    createdAt: tiedCreatedAt,
  }),
  seedRow(entityFollow, graphDids.publisher, "3jzfcijpj2z2c", {
    subject: { $type: "app.certified.defs#recordSubject", uri: graphUris.unresolvedFeature },
    createdAt: tiedCreatedAt,
  }),
  seedRow(entityFollow, graphDids.publisher, "3jzfcijpj2z2d", {
    subject: { $type: "app.certified.defs#recordSubject", uri: graphUris.secondFeature },
    createdAt: tiedCreatedAt,
  }),
  // The unresolved feature appears only in `via` here: it must not count as a follow of it.
  seedRow(entityFollow, graphDids.publisher, "3jzfcijpj2z2g", {
    subject: { $type: "app.certified.defs#recordSubject", uri: graphUris.followedFeature },
    createdAt: tiedCreatedAt,
    via: {
      uri: graphUris.unresolvedFeature,
      cid: "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy",
    },
  }),
  seedRow(entityFollow, graphDids.secondPublisher, "3jzfcijpj2z2e", {
    subject: { $type: "app.certified.defs#recordSubject", uri: graphUris.followedFeature },
    createdAt: tiedCreatedAt,
  }),
  seedRow(entityFollow, graphDids.thirdFollower, "3jzfcijpj2z2f", {
    subject: { $type: "app.certified.defs#recordSubject", uri: graphUris.followedFeature },
    createdAt: tiedCreatedAt,
  }),
];

const legacyViaCollection = `at://${graphDids.legacyOrg}/org.hypercerts.collection/3jzfcijpj2z2a`;
const cid = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

export const legacyFollowUris = {
  legacyOnly: `at://${graphDids.legacyOnly}/${accountFollow}/3jzfcijpj2z2a`,
  legacyEarlier: `at://${graphDids.legacyThenPlain}/${accountFollow}/3jzfcijpj2z2a`,
  plainLater: `at://${graphDids.legacyThenPlain}/${accountFollow}/3jzfcijpj2z2b`,
  legitCollection: `at://${graphDids.legitViaOtherCollection}/${accountFollow}/3jzfcijpj2z2a`,
  legitStarterPack: `at://${graphDids.legitViaStarterPack}/${accountFollow}/3jzfcijpj2z2a`,
};

// Rows 1-2 are legacy project follows (via is the followed org's own collection).
// Row 3 is the same publisher's genuine follow. Rows 4-5 have a real mediating record.
const legacyProjectFollows = [
  seedRow(accountFollow, graphDids.legacyOnly, "3jzfcijpj2z2a", {
    subject: graphDids.legacyOrg,
    createdAt: "2025-02-13T00:00:00.000Z",
    via: { uri: legacyViaCollection, cid },
  }),
  seedRow(accountFollow, graphDids.legacyThenPlain, "3jzfcijpj2z2a", {
    subject: graphDids.legacyOrg,
    createdAt: "2025-02-10T23:00:00.000Z",
    via: { uri: legacyViaCollection, cid },
  }),
  seedRow(accountFollow, graphDids.legacyThenPlain, "3jzfcijpj2z2b", {
    subject: graphDids.legacyOrg,
    createdAt: "2025-02-11T00:00:00.000Z",
  }),
  seedRow(accountFollow, graphDids.legitViaOtherCollection, "3jzfcijpj2z2a", {
    subject: graphDids.legacyOrg,
    createdAt: "2025-02-12T00:00:00.000Z",
    via: {
      uri: `at://${graphDids.curator}/org.hypercerts.collection/3jzfcijpj2z2a`,
      cid,
    },
  }),
  seedRow(accountFollow, graphDids.legitViaStarterPack, "3jzfcijpj2z2a", {
    subject: graphDids.legacyOrg,
    createdAt: "2025-02-12T01:00:00.000Z",
    via: {
      uri: `at://${graphDids.legacyOrg}/app.bsky.graph.starterpack/3jzfcijpj2z2a`,
      cid,
    },
  }),
];

const actorSidecars = [
  seedRow(profile, graphDids.publisher, "self", {
    displayName: "Graph Fixture Publisher",
    createdAt: indexedAt,
  }),
  seedRow(organization, graphDids.publisher, "self", {
    organizationType: ["nonprofit"],
    visibility: "public",
    createdAt: indexedAt,
  }),
  seedRow(profile, graphDids.primarySubject, "self", {
    displayName: "Primary Graph Subject",
    createdAt: indexedAt,
  }),
  seedRow(organization, graphDids.primarySubject, "self", {
    organizationType: ["cooperative"],
    visibility: "public",
    createdAt: indexedAt,
  }),
  seedRow(profile, graphDids.secondSubject, "self", {
    displayName: "Second Graph Subject",
    createdAt: indexedAt,
  }),
  seedRow(profile, graphDids.entityAuthor, "self", {
    displayName: "Graph Feature Author",
    createdAt: indexedAt,
  }),
];

const features = [
  seedRow(feature, graphDids.entityAuthor, "3jzfcijpj2z2a", {
    title: "Protected forest corridor",
    createdAt: tiedCreatedAt,
    locations: [],
    tags: [],
    sameAs: ["https://example.test/forest-corridor"],
  }),
  seedRow(feature, graphDids.entityAuthor, "3jzfcijpj2z2c", {
    title: "Community watershed",
    createdAt: tiedCreatedAt,
    locations: [],
    tags: [],
    sameAs: ["https://example.test/watershed"],
  }),
];

export const seedRows = await Promise.all([
  ...accountFollows,
  ...legacyProjectFollows,
  ...entityFollows,
  ...actorSidecars,
  ...features,
]);
