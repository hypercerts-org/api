import { encode } from "@atcute/cbor";
import * as CID from "@atcute/cid";
import { locationRecords } from "../../fixtures/records.js";

const profileCollection = "app.certified.actor.profile";
const organizationCollection = "app.certified.actor.organization";
const createdAt = "2025-02-01T00:00:00.000Z";
const indexedAt = "2025-03-03T04:05:06.000Z";

export const actorFixtureDids = {
  alpine: "did:plc:mmmmmmmmmmmmmmmmmmmmmmmm",
  forest: "did:plc:nnnnnnnnnnnnnnnnnnnnnnnn",
  river: "did:plc:oooooooooooooooooooooooo",
  profileOnly: "did:plc:pppppppppppppppppppppppp",
  organizationOnly: "did:plc:qqqqqqqqqqqqqqqqqqqqqqqq",
  unindexedLocation: "did:web:org-location-unindexed.example",
  wrongCollectionLocation: "did:web:org-location-wrong-collection.example",
};

const locationCollection = "app.certified.location";
const pointLocation = locationRecords.find(({ rkey }) => rkey === "3jzfcijpj2z2a");
const blobLocation = locationRecords.find(({ rkey }) => rkey === "3jzfcijpj2z2c");

// Primary-location scenarios: alpine pins the current point location, forest a blob-payload
// location, river a stale CID, and the two sidecar-only actors a never-indexed location and a
// reference to an indexed record in another collection. organizationOnly has no reference.
const primaryLocationRefs = {
  alpine: { uri: pointLocation.uri, cid: pointLocation.cid },
  forest: { uri: blobLocation.uri, cid: blobLocation.cid },
  river: { uri: pointLocation.uri, cid: blobLocation.cid },
  unindexed: {
    uri: `at://${pointLocation.did}/${locationCollection}/3jzfcijpj2z2z`,
    cid: pointLocation.cid,
  },
  wrongCollection: {
    uri: `at://${actorFixtureDids.alpine}/${profileCollection}/self`,
    cid: pointLocation.cid,
  },
};

const records = [
  {
    did: actorFixtureDids.alpine,
    collection: profileCollection,
    rkey: "self",
    record: {
      displayName: "Alpine Forest Consortium",
      description: "Forest restoration and mountain ecosystem monitoring.",
      createdAt,
    },
  },
  {
    did: actorFixtureDids.forest,
    collection: profileCollection,
    rkey: "self",
    record: {
      displayName: "Forest %_ Commons",
      description: "Community-led watershed restoration.",
      createdAt,
    },
  },
  {
    did: actorFixtureDids.river,
    collection: profileCollection,
    rkey: "self",
    record: {
      displayName: "River Observatory",
      description: "Forest and river monitoring data.",
      createdAt,
    },
  },
  {
    did: actorFixtureDids.profileOnly,
    collection: profileCollection,
    rkey: "self",
    record: {
      displayName: "Profile-only Research Group",
      description: "A profile without an organization sidecar.",
      createdAt,
    },
  },
  {
    did: actorFixtureDids.alpine,
    collection: organizationCollection,
    rkey: "self",
    record: {
      organizationType: ["nonprofit", "cooperative"],
      location: primaryLocationRefs.alpine,
      visibility: "public",
      createdAt,
    },
  },
  {
    did: actorFixtureDids.forest,
    collection: organizationCollection,
    rkey: "self",
    record: {
      organizationType: ["community"],
      location: primaryLocationRefs.forest,
      visibility: "unlisted",
      createdAt,
    },
  },
  {
    did: actorFixtureDids.river,
    collection: organizationCollection,
    rkey: "self",
    record: {
      organizationType: ["nonprofit"],
      location: primaryLocationRefs.river,
      visibility: "public",
      createdAt,
    },
  },
  {
    did: actorFixtureDids.organizationOnly,
    collection: organizationCollection,
    rkey: "self",
    record: {
      organizationType: ["community"],
      createdAt,
    },
  },
  {
    did: actorFixtureDids.unindexedLocation,
    collection: organizationCollection,
    rkey: "self",
    record: {
      organizationType: ["location-fixture"],
      location: primaryLocationRefs.unindexed,
      createdAt,
    },
  },
  {
    did: actorFixtureDids.wrongCollectionLocation,
    collection: organizationCollection,
    rkey: "self",
    record: {
      organizationType: ["location-fixture"],
      location: primaryLocationRefs.wrongCollection,
      createdAt,
    },
  },
];

export const seedRows = await Promise.all(
  records.map(async ({ did, collection, rkey, record, indexedAt: rowIndexedAt = indexedAt }) => {
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
  }),
);
