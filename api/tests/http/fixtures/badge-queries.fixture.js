import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const collections = {
  definition: 'app.certified.badge.definition',
  award: 'app.certified.badge.award',
  response: 'app.certified.badge.response',
  profile: 'app.certified.actor.profile',
  organization: 'app.certified.actor.organization',
};

export const badgeQueryDids = {
  publisher: 'did:plc:llllllllllllllllllllllll',
  partner: 'did:plc:mmmmmmmmmmmmmmmmmmmmmmmm',
  unlistedAuthor: 'did:plc:nnnnnnnnnnnnnnnnnnnnnnnn',
  recipient: 'did:plc:oooooooooooooooooooooooo',
  recordRecipient: 'did:plc:pppppppppppppppppppppppp',
};

const definitionCreatedAt = '2025-03-01T00:00:00.000Z';
const awardCreatedAt = '2025-03-02T00:00:00.000Z';
const responseCreatedAt = '2025-03-03T00:00:00.000Z';
const indexedAt = '2025-04-01T00:00:00.000Z';

function record(collection, did, rkey, fields) {
  return {
    uri: `at://${did}/${collection}/${rkey}`,
    did,
    collection,
    rkey,
    record: { $type: collection, ...fields },
  };
}

const definitions = {
  definitionA: record(collections.definition, badgeQueryDids.publisher, 'query-badge-a', {
    title: 'Cedar Query Badge A', badgeType: 'certification', createdAt: definitionCreatedAt,
    description: 'A query fixture for badge search and award filters.',
  }),
  definitionB: record(collections.definition, badgeQueryDids.publisher, 'query-badge-b', {
    title: 'Cedar Query Badge B', badgeType: 'certification', createdAt: definitionCreatedAt,
  }),
  definitionC: record(collections.definition, badgeQueryDids.publisher, 'query-badge-c', {
    title: 'Cedar Query Badge C', badgeType: 'certification', createdAt: definitionCreatedAt,
  }),
  definitionD: record(collections.definition, badgeQueryDids.publisher, 'query-badge-d', {
    title: 'Cedar Query Badge D', badgeType: 'certification', createdAt: definitionCreatedAt,
  }),
  definitionPartner: record(collections.definition, badgeQueryDids.partner, 'query-badge-partner', {
    title: 'Cedar Partner Recognition', badgeType: 'recognition', createdAt: '2025-03-02T00:00:00.000Z',
  }),
  definitionUnlisted: record(collections.definition, badgeQueryDids.unlistedAuthor, 'query-badge-unlisted', {
    title: 'Cedar Unlisted Participation', badgeType: 'participation', createdAt: '2025-03-03T00:00:00.000Z',
  }),
};

async function cidsFor(records) {
  return Object.fromEntries(await Promise.all(Object.entries(records).map(async ([name, item]) => [
    name,
    CID.toString(await CID.create(0x71, encode(item.record))),
  ])));
}

const definitionCids = await cidsFor(definitions);
const awardA = record(collections.award, badgeQueryDids.publisher, 'query-award-a', {
  badge: { uri: definitions.definitionA.uri, cid: definitionCids.definitionA },
  subject: badgeQueryDids.recipient,
  createdAt: awardCreatedAt,
});
const awardB = record(collections.award, badgeQueryDids.publisher, 'query-award-b', {
  badge: { uri: definitions.definitionA.uri, cid: definitionCids.definitionA },
  subject: {
    $type: 'com.atproto.repo.strongRef',
    uri: `at://${badgeQueryDids.recordRecipient}/org.hypercerts.claim.activity/claim-one`,
    cid: definitionCids.definitionA,
  },
  createdAt: awardCreatedAt,
});
const awardC = record(collections.award, badgeQueryDids.publisher, 'query-award-c', {
  badge: { uri: definitions.definitionA.uri, cid: definitionCids.definitionA },
  subject: badgeQueryDids.recipient,
  createdAt: awardCreatedAt,
});
const awardD = record(collections.award, badgeQueryDids.publisher, 'query-award-d', {
  badge: { uri: definitions.definitionA.uri, cid: 'bafyre-old-definition-version' },
  subject: badgeQueryDids.unlistedAuthor,
  createdAt: awardCreatedAt,
});
const awardPartner = record(collections.award, badgeQueryDids.partner, 'query-award-partner', {
  badge: { uri: definitions.definitionPartner.uri, cid: definitionCids.definitionPartner },
  subject: badgeQueryDids.recordRecipient,
  createdAt: '2025-03-04T00:00:00.000Z',
});

const awardCids = await cidsFor({ awardA, awardB, awardC, awardD, awardPartner });
const response = (did, rkey, award, cid, status, createdAt = responseCreatedAt) => record(
  collections.response,
  did,
  rkey,
  {
    badgeAward: { $type: 'com.atproto.repo.strongRef', uri: award.uri, cid },
    response: status,
    createdAt,
  },
);

const responses = {
  responseAccepted: response(badgeQueryDids.recipient, 'query-response-a', awardA, awardCids.awardA, 'accepted'),
  responseOlderAwardVersion: response(badgeQueryDids.recipient, 'query-response-b', awardA, 'bafyre-old-award-version', 'rejected'),
  responseDeferred: response(badgeQueryDids.recipient, 'query-response-c', awardA, awardCids.awardA, 'deferred'),
  responseForeign: response(badgeQueryDids.unlistedAuthor, 'query-response-d', awardA, awardCids.awardA, 'rejected'),
  responseRecordRecipient: response(badgeQueryDids.recordRecipient, 'query-response-record-recipient', awardB, awardCids.awardB, 'rejected'),
  responseWrongRecipient: response(badgeQueryDids.unlistedAuthor, 'query-response-wrong-recipient', awardC, awardCids.awardC, 'accepted'),
};

const actors = {
  publisherProfile: record(collections.profile, badgeQueryDids.publisher, 'self', {
    displayName: 'Cedar Query Publisher', createdAt: indexedAt,
  }),
  partnerOrganization: record(collections.organization, badgeQueryDids.partner, 'self', {
    organizationType: ['nonprofit'], visibility: 'public', createdAt: indexedAt,
  }),
  recipientProfile: record(collections.profile, badgeQueryDids.recipient, 'self', {
    displayName: 'Cedar Query Recipient', createdAt: indexedAt,
  }),
};

export const canonicalRecords = {
  ...definitions,
  awardA,
  awardB,
  awardC,
  awardD,
  awardPartner,
  ...responses,
  ...actors,
};

export const canonicalCids = await cidsFor(canonicalRecords);

export const seedRows = Object.entries(canonicalRecords).map(([name, item]) => ({
  ...item,
  cid: canonicalCids[name],
  indexedAt,
}));
