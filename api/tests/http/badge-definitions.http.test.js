import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const getEndpoint = 'app.certified.badge.getBadgeDefinition';
const listEndpoint = 'app.certified.badge.listBadgeDefinitions';
const badgeCollection = 'app.certified.badge.definition';
const publisherA = 'did:plc:iiiiiiiiiiiiiiiiiiiiiiii';
const publisherB = 'did:plc:jjjjjjjjjjjjjjjjjjjjjjjj';
const publisherOutsideFilter = 'did:plc:kkkkkkkkkkkkkkkkkkkkkkkk';
const allowedIssuer = 'did:plc:dddddddddddddddddddddddd';
const badgeUris = {
  certification: `at://${publisherA}/${badgeCollection}/3jzfcijpj2z2a`,
  recognition: `at://${publisherA}/${badgeCollection}/3jzfcijpj2z2b`,
  secondPublisher: `at://${publisherB}/${badgeCollection}/3jzfcijpj2z2c`,
  outsidePublisher: `at://${publisherOutsideFilter}/${badgeCollection}/3jzfcijpj2z2d`,
  later: `at://${publisherA}/${badgeCollection}/3jzfcijpj2z2e`,
};

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

test('getBadgeDefinition returns the CBOR-addressed definition and publisher sidecars', async () => {
  const { response, body } = await requestBadgeEndpoint(getEndpoint, { uri: badgeUris.certification });
  assert.equal(response.status, 200, JSON.stringify(body));

  const { badgeDefinition } = body;
  assert.equal(badgeDefinition.uri, badgeUris.certification);
  assert.equal(badgeDefinition.cid, 'bafyreibhximffqvxfmca2i3vmkzlw3jgmyimhuqy6q2brzwrym6hnvkrou');
  assert.equal(badgeDefinition.indexedAt, '2025-02-03T04:05:06.000Z');
  assert.equal(badgeDefinition.did, publisherA);
  assert.deepEqual(badgeDefinition.record, {
    $type: badgeCollection,
    title: 'River restoration certification',
    badgeType: 'certification',
    createdAt: '2025-02-01T00:00:00.000Z',
    description: 'Recognizes verified river restoration outcomes.',
    icon: {
      $type: 'blob',
      ref: { $link: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy' },
      mimeType: 'image/png',
      size: 32768,
    },
    allowedIssuers: [{ did: allowedIssuer }],
  });
  assert.equal(badgeDefinition.author.did, publisherA);
  assert.equal(badgeDefinition.author.profile.uri, `at://${publisherA}/app.certified.actor.profile/self`);
  assert.deepEqual(badgeDefinition.author.profile.record, {
    $type: 'app.certified.actor.profile',
    displayName: 'River Stewardship Alliance',
    description: 'Regional watershed restoration and monitoring.',
    createdAt: '2025-02-03T04:05:06.000Z',
  });
  assert.equal(badgeDefinition.author.organization, null);
});

test('getBadgeDefinition returns RecordNotFound using the pinned HappyView runtime error response', async () => {
  const missingUri = `at://${publisherA}/${badgeCollection}/3jzfcijpj2z2z`;
  const { response, body } = await requestBadgeEndpoint(getEndpoint, { uri: missingUri });

  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, getEndpoint);
  assert.match(body.message, /RecordNotFound/);
});

test('listBadgeDefinitions ORs authors and badge types while intersecting the two filters', async () => {
  const { response, body } = await requestBadgeEndpoint(listEndpoint, {
    authors: [publisherA, publisherB],
    badgeTypes: ['certification', 'recognition'],
    sortDirection: 'asc',
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.badgeDefinitions.map(({ uri }) => uri), [
    badgeUris.certification,
    badgeUris.recognition,
    badgeUris.secondPublisher,
  ]);
  assert.equal(body.badgeDefinitions[0].record.title, 'River restoration certification');
  assert.equal(body.badgeDefinitions[1].record.badgeType, 'recognition');
  assert.equal(body.badgeDefinitions[2].author.did, publisherB);
  assert.equal(body.badgeDefinitions[2].author.profile, null);
  assert.deepEqual(body.badgeDefinitions[2].author.organization.record.organizationType, ['nonprofit', 'cooperative']);
  assert.equal(Object.hasOwn(body, 'cursor'), false);
});

test('listBadgeDefinitions paginates createdAt ties by URI without repeats or omissions', async () => {
  const first = await requestBadgeEndpoint(listEndpoint, { sortDirection: 'asc', limit: 2 });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.badgeDefinitions.map(({ uri }) => uri), [badgeUris.certification, badgeUris.recognition]);
  assert.equal(typeof first.body.cursor, 'string');

  const second = await requestBadgeEndpoint(listEndpoint, {
    sortDirection: 'asc', limit: 2, cursor: first.body.cursor,
  });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.badgeDefinitions.map(({ uri }) => uri), [badgeUris.secondPublisher, badgeUris.outsidePublisher]);
  assert.equal(typeof second.body.cursor, 'string');

  const third = await requestBadgeEndpoint(listEndpoint, {
    sortDirection: 'asc', limit: 2, cursor: second.body.cursor,
  });
  assert.equal(third.response.status, 200, JSON.stringify(third.body));
  assert.deepEqual(third.body.badgeDefinitions.map(({ uri }) => uri), [badgeUris.later]);
  assert.equal(Object.hasOwn(third.body, 'cursor'), false);
});

test('listBadgeDefinitions exposes InvalidRequest using the pinned HappyView runtime error response', async () => {
  const { response, body } = await requestBadgeEndpoint(listEndpoint, { limit: 101 });

  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, listEndpoint);
  assert.match(body.message, /InvalidRequest/);
});
