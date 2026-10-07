import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';
import { badgeQueryDids, canonicalCids, canonicalRecords } from './fixtures/badge-queries.fixture.js';

const endpoints = {
  searchBadgeDefinitions: 'app.certified.badge.searchBadgeDefinitions',
  getBadgeAward: 'app.certified.badge.getBadgeAward',
  listBadgeAwards: 'app.certified.badge.listBadgeAwards',
  getBadgeResponse: 'app.certified.badge.getBadgeResponse',
  listBadgeResponses: 'app.certified.badge.listBadgeResponses',
};
const definitionUri = canonicalRecords.definitionA.uri;
const partnerDefinitionUri = canonicalRecords.definitionPartner.uri;
const awardUri = canonicalRecords.awardA.uri;
const recordSubjectUri = canonicalRecords.awardB.record.subject.uri;

async function requestBadgeEndpoint(endpoint, params = {}) {
  const url = contractUrl(requireContractTarget(), endpoint, params);
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body };
}

async function assertBidirectionalPages(endpoint, resultKey, filters, expectedPages) {
  for (const [direction, pages] of Object.entries(expectedPages)) {
    let cursor;
    for (const [index, expectedUris] of pages.entries()) {
      const params = { ...filters, sortDirection: direction, limit: 2 };
      if (cursor) params.cursor = cursor;
      const { response, body } = await requestBadgeEndpoint(endpoint, params);
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.deepEqual(body[resultKey].map(({ uri }) => uri), expectedUris);
      if (index < pages.length - 1) {
        assert.equal(typeof body.cursor, 'string');
        cursor = body.cursor;
      } else {
        assert.equal(Object.hasOwn(body, 'cursor'), false);
      }
    }
  }
}

async function assertRuntimeError(endpoint, params, errorName) {
  const { response, body } = await requestBadgeEndpoint(endpoint, params);
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, endpoint);
  assert.match(body.message, new RegExp(errorName));
}

test('searchBadgeDefinitions returns the matching record with its CBOR CID and publisher sidecar', async () => {
  const { response, body } = await requestBadgeEndpoint(endpoints.searchBadgeDefinitions, {
    search: '  cEdAr qUeRy bAdGe a  ',
    authors: [badgeQueryDids.publisher],
    badgeTypes: ['certification'],
  });

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.badgeDefinitions.map(({ uri }) => uri), [canonicalRecords.definitionA.uri]);
  const [badgeDefinition] = body.badgeDefinitions;
  assert.equal(badgeDefinition.cid, 'bafyreiatp3bngjbyu5skyqanyt3nr7riaxsmyok73bsuzn2sz52i2oft5a');
  assert.deepEqual(badgeDefinition.record, canonicalRecords.definitionA.record);
  assert.equal(badgeDefinition.author.did, badgeQueryDids.publisher);
  assert.equal(badgeDefinition.author.profile.record.displayName, 'Cedar Query Publisher');
  assert.equal(badgeDefinition.author.organization, null);
});

test('blank badge search includes baseline definitions and represents missing actor sidecars as null', async () => {
  const { response, body } = await requestBadgeEndpoint(endpoints.searchBadgeDefinitions, {
    search: '   ', sortDirection: 'asc', limit: 100,
  });

  assert.equal(response.status, 200, JSON.stringify(body));
  const baselineUris = [
    'at://did:plc:iiiiiiiiiiiiiiiiiiiiiiii/app.certified.badge.definition/3jzfcijpj2z2a',
    'at://did:plc:iiiiiiiiiiiiiiiiiiiiiiii/app.certified.badge.definition/3jzfcijpj2z2b',
    'at://did:plc:jjjjjjjjjjjjjjjjjjjjjjjj/app.certified.badge.definition/3jzfcijpj2z2c',
    'at://did:plc:kkkkkkkkkkkkkkkkkkkkkkkk/app.certified.badge.definition/3jzfcijpj2z2d',
    'at://did:plc:iiiiiiiiiiiiiiiiiiiiiiii/app.certified.badge.definition/3jzfcijpj2z2e',
  ];
  const ownUris = Object.entries(canonicalRecords)
    .filter(([name]) => name.startsWith('definition'))
    .map(([, record]) => record.uri);
  const actualUris = body.badgeDefinitions.map(({ uri }) => uri);
  assert.deepEqual([...actualUris].sort(), [...baselineUris, ...ownUris].sort());

  const partner = body.badgeDefinitions.find(({ uri }) => uri === partnerDefinitionUri);
  assert.equal(partner.author.profile, null);
  assert.equal(partner.author.organization.record.visibility, 'public');
  const unlisted = body.badgeDefinitions.find(({ uri }) => uri === canonicalRecords.definitionUnlisted.uri);
  assert.equal(unlisted.author.profile, null);
  assert.equal(unlisted.author.organization, null);
});

test('searchBadgeDefinitions filters discriminately and traverses createdAt ties in both directions', async () => {
  const filters = {
    search: 'Cedar Query Badge',
    authors: [badgeQueryDids.publisher],
    badgeTypes: ['certification'],
  };
  const definitions = ['definitionA', 'definitionB', 'definitionC', 'definitionD']
    .map((name) => canonicalRecords[name].uri);
  await assertBidirectionalPages(endpoints.searchBadgeDefinitions, 'badgeDefinitions', filters, {
    asc: [[definitions[0], definitions[1]], [definitions[2], definitions[3]]],
    desc: [[definitions[3], definitions[2]], [definitions[1], definitions[0]]],
  });

  for (const params of [
    { ...filters, search: 'No Cedar Badge Matches This' },
    { ...filters, authors: [badgeQueryDids.partner] },
    { ...filters, badgeTypes: ['recognition'] },
  ]) {
    const { response, body } = await requestBadgeEndpoint(endpoints.searchBadgeDefinitions, params);
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body.badgeDefinitions, []);
  }
});

test('searchBadgeDefinitions returns its named runtime error for an invalid page limit', async () => {
  await assertRuntimeError(endpoints.searchBadgeDefinitions, { search: 'Cedar', limit: 101 }, 'InvalidRequest');
});

test('getBadgeAward retrieves the exact award version and latest eligible recipient response', async () => {
  const { response, body } = await requestBadgeEndpoint(endpoints.getBadgeAward, {
    uri: canonicalRecords.awardA.uri,
  });

  assert.equal(response.status, 200, JSON.stringify(body));
  const { badgeAward } = body;
  assert.equal(badgeAward.uri, canonicalRecords.awardA.uri);
  assert.equal(badgeAward.cid, canonicalCids.awardA);
  assert.deepEqual(badgeAward.record, canonicalRecords.awardA.record);
  assert.equal(badgeAward.badge.uri, definitionUri);
  assert.equal(badgeAward.badge.cid, 'bafyreiatp3bngjbyu5skyqanyt3nr7riaxsmyok73bsuzn2sz52i2oft5a');
  assert.deepEqual(badgeAward.badge.record, canonicalRecords.definitionA.record);
  assert.equal(badgeAward.responseStatus, 'accepted');
  assert.equal(badgeAward.recipientResponse.uri, canonicalRecords.responseNewestAccepted.uri);
  assert.equal(badgeAward.recipientResponse.cid, canonicalCids.responseNewestAccepted);
  assert.equal(badgeAward.recipientResponse.indexedAt, canonicalRecords.responseNewestAccepted.indexedAt);
  assert.equal(badgeAward.recipientResponse.record.badgeAward.uri, canonicalRecords.awardA.uri);
  assert.equal(badgeAward.recipientResponse.record.badgeAward.cid, canonicalCids.awardA);
  assert.equal(badgeAward.author.profile.record.displayName, 'Cedar Query Publisher');
  assert.equal(badgeAward.author.organization, null);

  const recordRecipient = await requestBadgeEndpoint(endpoints.getBadgeAward, {
    uri: canonicalRecords.awardB.uri,
  });
  assert.equal(recordRecipient.response.status, 200, JSON.stringify(recordRecipient.body));
  assert.equal(recordRecipient.body.badgeAward.responseStatus, 'rejected');
  assert.equal(recordRecipient.body.badgeAward.recipientResponse.uri, canonicalRecords.responseRecordRecipient.uri);

  const bareStringDid = await requestBadgeEndpoint(endpoints.getBadgeAward, {
    uri: canonicalRecords.awardPartner.uri,
  });
  assert.equal(bareStringDid.response.status, 200, JSON.stringify(bareStringDid.body));
  assert.equal(bareStringDid.body.badgeAward.uri, canonicalRecords.awardPartner.uri);
  assert.equal(bareStringDid.body.badgeAward.cid, canonicalCids.awardPartner);
  assert.equal(bareStringDid.body.badgeAward.author.did, badgeQueryDids.partner);
  assert.equal(bareStringDid.body.badgeAward.responseStatus, 'accepted');
  assert.equal(bareStringDid.body.badgeAward.recipientResponse.uri, canonicalRecords.responseBareStringDid.uri);
  assert.equal(bareStringDid.body.badgeAward.recipientResponse.cid, canonicalCids.responseBareStringDid);
  assert.equal(bareStringDid.body.badgeAward.recipientResponse.did, badgeQueryDids.recordRecipient);
  assert.equal(bareStringDid.body.badgeAward.recipientResponse.record.badgeAward.uri, canonicalRecords.awardPartner.uri);
  assert.equal(bareStringDid.body.badgeAward.recipientResponse.record.badgeAward.cid, canonicalCids.awardPartner);

  const unansweredObjectDid = await requestBadgeEndpoint(endpoints.getBadgeAward, {
    uri: canonicalRecords.awardC.uri,
  });
  assert.equal(unansweredObjectDid.response.status, 200, JSON.stringify(unansweredObjectDid.body));
  assert.equal(unansweredObjectDid.body.badgeAward.responseStatus, 'unanswered');
  assert.equal(unansweredObjectDid.body.badgeAward.recipientResponse, null);

  const unavailableVersion = await requestBadgeEndpoint(endpoints.getBadgeAward, {
    uri: canonicalRecords.awardD.uri,
  });
  assert.equal(unavailableVersion.response.status, 200, JSON.stringify(unavailableVersion.body));
  assert.equal(unavailableVersion.body.badgeAward.badge, null);
  assert.equal(unavailableVersion.body.badgeAward.responseStatus, 'unanswered');
  assert.equal(unavailableVersion.body.badgeAward.recipientResponse, null);
});

test('getBadgeAward returns RecordNotFound through the pinned runtime error response', async () => {
  await assertRuntimeError(endpoints.getBadgeAward, {
    uri: `at://${badgeQueryDids.publisher}/app.certified.badge.award/not-indexed`,
  }, 'RecordNotFound');
});

test('listBadgeAwards returns the full feed with exact-version and actor-sidecar nulls', async () => {
  const { response, body } = await requestBadgeEndpoint(endpoints.listBadgeAwards, {
    sortDirection: 'asc', limit: 100,
  });

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.badgeAwards.map(({ uri }) => uri), [
    canonicalRecords.awardA.uri,
    canonicalRecords.awardB.uri,
    canonicalRecords.awardC.uri,
    canonicalRecords.awardD.uri,
    canonicalRecords.awardOtherAuthor.uri,
    canonicalRecords.awardPartner.uri,
  ]);
  const awardA = body.badgeAwards.find(({ uri }) => uri === canonicalRecords.awardA.uri);
  assert.equal(awardA.badge.record.title, 'Cedar Query Badge A');
  assert.equal(awardA.responseStatus, 'accepted');
  assert.equal(awardA.recipientResponse.uri, canonicalRecords.responseNewestAccepted.uri);
  assert.equal(awardA.recipientResponse.cid, canonicalCids.responseNewestAccepted);
  assert.equal(awardA.recipientResponse.record.badgeAward.uri, canonicalRecords.awardA.uri);
  assert.equal(awardA.recipientResponse.record.badgeAward.cid, canonicalCids.awardA);
  assert.equal(awardA.author.profile.record.displayName, 'Cedar Query Publisher');
  assert.equal(awardA.author.organization, null);
  const awardC = body.badgeAwards.find(({ uri }) => uri === canonicalRecords.awardC.uri);
  assert.equal(awardC.responseStatus, 'unanswered');
  assert.equal(awardC.recipientResponse, null);
  const awardB = body.badgeAwards.find(({ uri }) => uri === canonicalRecords.awardB.uri);
  assert.equal(awardB.responseStatus, 'rejected');
  assert.equal(awardB.recipientResponse.uri, canonicalRecords.responseRecordRecipient.uri);
  const awardD = body.badgeAwards.find(({ uri }) => uri === canonicalRecords.awardD.uri);
  assert.equal(awardD.badge, null);
  const partnerAward = body.badgeAwards.find(({ uri }) => uri === canonicalRecords.awardPartner.uri);
  assert.equal(partnerAward.author.profile, null);
  assert.equal(partnerAward.author.organization.record.visibility, 'public');
  assert.equal(partnerAward.responseStatus, 'accepted');
  assert.equal(partnerAward.recipientResponse.uri, canonicalRecords.responseBareStringDid.uri);
});

test('listBadgeAwards combines discriminating filters and traverses ties in both directions', async () => {
  const filters = { authors: [badgeQueryDids.publisher], badgeUris: [definitionUri] };
  const awards = ['awardA', 'awardB', 'awardC', 'awardD'].map((name) => canonicalRecords[name].uri);
  await assertBidirectionalPages(endpoints.listBadgeAwards, 'badgeAwards', filters, {
    asc: [[awards[0], awards[1]], [awards[2], awards[3]]],
    desc: [[awards[3], awards[2]], [awards[1], awards[0]]],
  });

  const positive = await requestBadgeEndpoint(endpoints.listBadgeAwards, {
    authors: [badgeQueryDids.publisher],
    badgeUris: [definitionUri],
    badgeTypes: ['certification'],
    subjects: [badgeQueryDids.recipient, recordSubjectUri],
    responses: ['accepted', 'rejected'],
    sortDirection: 'asc',
  });
  assert.equal(positive.response.status, 200, JSON.stringify(positive.body));
  assert.deepEqual(positive.body.badgeAwards.map(({ uri }) => uri), [
    canonicalRecords.awardA.uri,
    canonicalRecords.awardB.uri,
  ]);

  const otherAuthorSubjectMatch = await requestBadgeEndpoint(endpoints.listBadgeAwards, {
    authors: [badgeQueryDids.partner],
    badgeUris: [definitionUri],
    badgeTypes: ['certification'],
    subjects: [recordSubjectUri],
    responses: ['accepted', 'rejected'],
  });
  assert.equal(otherAuthorSubjectMatch.response.status, 200, JSON.stringify(otherAuthorSubjectMatch.body));
  assert.deepEqual(otherAuthorSubjectMatch.body.badgeAwards.map(({ uri }) => uri), [canonicalRecords.awardOtherAuthor.uri]);

  const legacyBareDid = await requestBadgeEndpoint(endpoints.listBadgeAwards, {
    authors: [badgeQueryDids.partner],
    badgeUris: [partnerDefinitionUri],
    subjects: [badgeQueryDids.recordRecipient],
    responses: ['accepted'],
  });
  assert.equal(legacyBareDid.response.status, 200, JSON.stringify(legacyBareDid.body));
  assert.deepEqual(legacyBareDid.body.badgeAwards.map(({ uri }) => uri), [canonicalRecords.awardPartner.uri]);
  const bareStringDidAward = legacyBareDid.body.badgeAwards[0];
  assert.equal(bareStringDidAward.cid, canonicalCids.awardPartner);
  assert.equal(bareStringDidAward.responseStatus, 'accepted');
  assert.equal(bareStringDidAward.recipientResponse.uri, canonicalRecords.responseBareStringDid.uri);
  assert.equal(bareStringDidAward.recipientResponse.did, badgeQueryDids.recordRecipient);
  assert.equal(bareStringDidAward.recipientResponse.cid, canonicalCids.responseBareStringDid);
  assert.equal(bareStringDidAward.recipientResponse.record.badgeAward.uri, canonicalRecords.awardPartner.uri);
  assert.equal(bareStringDidAward.recipientResponse.record.badgeAward.cid, canonicalCids.awardPartner);

  const supersededAcceptedRecipient = await requestBadgeEndpoint(endpoints.listBadgeAwards, {
    authors: [badgeQueryDids.publisher], badgeUris: [definitionUri],
    subjects: [badgeQueryDids.recipient], responses: ['accepted'],
  });
  assert.equal(supersededAcceptedRecipient.response.status, 200, JSON.stringify(supersededAcceptedRecipient.body));
  assert.deepEqual(supersededAcceptedRecipient.body.badgeAwards.map(({ uri }) => uri), [canonicalRecords.awardA.uri]);

  const unmatchedFilters = [
    { authors: [badgeQueryDids.partner] },
    { badgeUris: [partnerDefinitionUri] },
    { badgeTypes: ['recognition'] },
    { subjects: ['did:web:no-such-badge-recipient.example'] },
    { subjects: [badgeQueryDids.recipient], responses: ['rejected'] },
  ];
  for (const extra of unmatchedFilters) {
    const { response, body } = await requestBadgeEndpoint(endpoints.listBadgeAwards, {
      ...filters, ...extra,
    });
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body.badgeAwards, []);
  }

  const exactBadgeType = await requestBadgeEndpoint(endpoints.listBadgeAwards, {
    authors: [badgeQueryDids.publisher], badgeUris: [definitionUri], badgeTypes: ['certification'],
  });
  assert.equal(exactBadgeType.response.status, 200, JSON.stringify(exactBadgeType.body));
  assert.deepEqual(exactBadgeType.body.badgeAwards.map(({ uri }) => uri), [
    awards[2],
    awards[1],
    awards[0],
  ]);
});

test('listBadgeAwards returns InvalidRequest through the pinned runtime error response', async () => {
  await assertRuntimeError(endpoints.listBadgeAwards, {
    subjects: ['not-a-DID-or-record-AT-URI'],
  }, 'InvalidRequest');
});

test('getBadgeResponse retrieves a raw response with its independent CBOR CID and publisher sidecar', async () => {
  const { response, body } = await requestBadgeEndpoint(endpoints.getBadgeResponse, {
    uri: canonicalRecords.responseAccepted.uri,
  });

  assert.equal(response.status, 200, JSON.stringify(body));
  const { badgeResponse } = body;
  assert.equal(badgeResponse.uri, canonicalRecords.responseAccepted.uri);
  assert.equal(badgeResponse.cid, canonicalCids.responseAccepted);
  assert.deepEqual(badgeResponse.record, canonicalRecords.responseAccepted.record);
  assert.equal(badgeResponse.record.response, 'accepted');
  assert.equal(badgeResponse.author.did, badgeQueryDids.recipient);
  assert.equal(badgeResponse.author.profile.record.displayName, 'Cedar Query Recipient');
  assert.equal(badgeResponse.author.organization, null);
  assert.equal(Object.hasOwn(badgeResponse, 'badgeAward'), false);
});

test('getBadgeResponse returns RecordNotFound through the pinned runtime error response', async () => {
  await assertRuntimeError(endpoints.getBadgeResponse, {
    uri: `at://${badgeQueryDids.publisher}/app.certified.badge.response/not-indexed`,
  }, 'RecordNotFound');
});

test('listBadgeResponses preserves the full raw feed, URI-only matching, and bidirectional tied pagination', async () => {
  const allResponses = await requestBadgeEndpoint(endpoints.listBadgeResponses, {
    sortDirection: 'asc', limit: 100,
  });
  assert.equal(allResponses.response.status, 200, JSON.stringify(allResponses.body));
  const expectedAll = Object.entries(canonicalRecords)
    .filter(([name]) => name.startsWith('response'))
    .map(([, record]) => record.uri);
  assert.deepEqual(
    [...allResponses.body.badgeResponses.map(({ uri }) => uri)].sort(),
    [...expectedAll].sort(),
  );

  const uriFiltered = ['responseAccepted', 'responseOlderAwardVersion', 'responseDeferred', 'responseRejected', 'responseNewestAccepted', 'responseForeign']
    .map((name) => canonicalRecords[name].uri);
  await assertBidirectionalPages(endpoints.listBadgeResponses, 'badgeResponses', { badgeAward: awardUri }, {
    asc: [[uriFiltered[0], uriFiltered[1]], [uriFiltered[2], uriFiltered[3]], [uriFiltered[4], uriFiltered[5]]],
    desc: [[uriFiltered[5], uriFiltered[4]], [uriFiltered[3], uriFiltered[2]], [uriFiltered[1], uriFiltered[0]]],
  });

  const firstPage = await requestBadgeEndpoint(endpoints.listBadgeResponses, {
    badgeAward: awardUri, sortDirection: 'asc', limit: 100,
  });
  assert.equal(firstPage.response.status, 200, JSON.stringify(firstPage.body));
  const newestEligible = firstPage.body.badgeResponses.find(({ uri }) => uri === canonicalRecords.responseNewestAccepted.uri);
  assert.equal(newestEligible.record.badgeAward.uri, canonicalRecords.awardA.uri);
  assert.equal(newestEligible.record.badgeAward.cid, canonicalCids.awardA);
  assert.equal(newestEligible.author.did, badgeQueryDids.recipient);
  assert.equal(newestEligible.record.response, 'accepted');
  assert.equal(newestEligible.indexedAt, canonicalRecords.responseNewestAccepted.indexedAt);
  const earlierEligibleRejected = firstPage.body.badgeResponses.find(({ uri }) => uri === canonicalRecords.responseRejected.uri);
  assert.equal(earlierEligibleRejected.author.did, badgeQueryDids.recipient);
  assert.equal(earlierEligibleRejected.record.badgeAward.uri, canonicalRecords.awardA.uri);
  assert.equal(earlierEligibleRejected.record.badgeAward.cid, canonicalCids.awardA);
  assert.equal(earlierEligibleRejected.record.response, 'rejected');
  assert.ok(Date.parse(earlierEligibleRejected.indexedAt) < Date.parse(newestEligible.indexedAt));
  for (const name of ['responseForeign', 'responseOlderAwardVersion', 'responseDeferred']) {
    const decoy = firstPage.body.badgeResponses.find(({ uri }) => uri === canonicalRecords[name].uri);
    assert.ok(Date.parse(decoy.indexedAt) > Date.parse(newestEligible.indexedAt), `${name} must be indexed after the newest eligible response`);
  }
  const olderAwardVersion = firstPage.body.badgeResponses.find(({ uri }) => uri === canonicalRecords.responseOlderAwardVersion.uri);
  assert.equal(olderAwardVersion.author.did, badgeQueryDids.recipient);
  assert.equal(olderAwardVersion.record.badgeAward.uri, canonicalRecords.awardA.uri);
  assert.equal(olderAwardVersion.record.badgeAward.cid, 'bafyre-old-award-version');
  assert.equal(olderAwardVersion.record.response, 'rejected');
  const deferred = firstPage.body.badgeResponses.find(({ uri }) => uri === canonicalRecords.responseDeferred.uri);
  assert.equal(deferred.author.did, badgeQueryDids.recipient);
  assert.equal(deferred.record.badgeAward.uri, canonicalRecords.awardA.uri);
  assert.equal(deferred.record.badgeAward.cid, canonicalCids.awardA);
  assert.equal(deferred.record.response, 'deferred');
  const foreign = firstPage.body.badgeResponses.find(({ uri }) => uri === canonicalRecords.responseForeign.uri);
  assert.equal(foreign.record.badgeAward.uri, canonicalRecords.awardA.uri);
  assert.equal(foreign.record.badgeAward.cid, canonicalCids.awardA);
  assert.equal(foreign.record.response, 'rejected');
  assert.equal(foreign.author.did, badgeQueryDids.unlistedAuthor);
  assert.equal(foreign.author.profile, null);
  assert.equal(foreign.author.organization, null);
  const accepted = firstPage.body.badgeResponses.find(({ uri }) => uri === canonicalRecords.responseAccepted.uri);
  assert.equal(accepted.author.profile.record.displayName, 'Cedar Query Recipient');
  assert.equal(accepted.author.organization, null);
  assert.equal(Object.hasOwn(accepted, 'badgeAward'), false);

  const noMatches = await requestBadgeEndpoint(endpoints.listBadgeResponses, {
    badgeAward: `at://${badgeQueryDids.publisher}/app.certified.badge.award/not-indexed`,
  });
  assert.equal(noMatches.response.status, 200, JSON.stringify(noMatches.body));
  assert.deepEqual(noMatches.body.badgeResponses, []);
});

test('listBadgeResponses returns InvalidRequest through the pinned runtime error response', async () => {
  await assertRuntimeError(endpoints.listBadgeResponses, { limit: 101 }, 'InvalidRequest');
});
