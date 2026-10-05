import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const getEndpoint = 'org.hypercerts.entity.getFeature';
const listEndpoint = 'org.hypercerts.entity.listFeatures';
const featureCollection = 'org.hypercerts.entity.feature';
const featureAuthor = 'did:plc:xxxxxxxxxxxxxxxxxxxxxxxx';
const profileOnlyAuthor = 'did:plc:yyyyyyyyyyyyyyyyyyyyyyyy';
const unhydratedAuthor = 'did:plc:zzzzzzzzzzzzzzzzzzzzzzzz';
const featureUris = {
  bog: `at://${profileOnlyAuthor}/${featureCollection}/feature-bog`,
  older: `at://${profileOnlyAuthor}/${featureCollection}/feature-older`,
  alpha: `at://${featureAuthor}/${featureCollection}/feature-alpha`,
  beta: `at://${featureAuthor}/${featureCollection}/feature-beta`,
  gamma: `at://${profileOnlyAuthor}/${featureCollection}/feature-gamma`,
  newer: `at://${unhydratedAuthor}/${featureCollection}/feature-newer`,
};

async function request(endpoint, params) {
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

function assertNamedRuntimeError(result, endpoint, name) {
  assert.equal(result.response.status, 500, JSON.stringify(result.body));
  assert.equal(result.body.error, 'script_error');
  assert.equal(result.body.errorType, 'runtime');
  assert.equal(result.body.method, endpoint);
  assert.match(result.body.message, new RegExp(name));
}

test('getFeature returns the indexed feature and hydrated author sidecars over HTTP', async () => {
  const { response, body } = await request(getEndpoint, { uri: featureUris.alpha });
  assert.equal(response.status, 200, JSON.stringify(body));

  const { feature } = body;
  assert.equal(feature.$type, 'org.hypercerts.entity.defs#featureView');
  assert.equal(feature.uri, featureUris.alpha);
  assert.equal(feature.cid, 'bafyreihxfwqj46nvd4ene4of7sbfoxq7n2v3aa5r4z6oxmuk6bh54637wm');
  assert.equal(feature.indexedAt, '2025-03-03T04:05:06.000Z');
  assert.equal(feature.did, featureAuthor);
  assert.deepEqual(feature.record, {
    $type: featureCollection,
    type: 'wetland',
    title: 'Wang Chhu floodplain',
    createdAt: '2025-03-01T00:00:00.000Z',
    locations: [],
    tags: [],
    sameAs: [],
  });

  assert.equal(feature.author.did, featureAuthor);
  assert.equal(feature.author.profile.uri, `at://${featureAuthor}/app.certified.actor.profile/self`);
  assert.equal(feature.author.profile.did, featureAuthor);
  assert.deepEqual(feature.author.profile.record, {
    $type: 'app.certified.actor.profile',
    displayName: 'River Stewardship Alliance',
    description: 'Community wetland monitoring and restoration.',
    createdAt: '2025-03-03T04:05:06.000Z',
  });
  assert.equal(feature.author.organization.uri, `at://${featureAuthor}/app.certified.actor.organization/self`);
  assert.equal(feature.author.organization.did, featureAuthor);
  assert.deepEqual(feature.author.organization.record, {
    $type: 'app.certified.actor.organization',
    organizationType: ['community'],
    visibility: 'public',
    createdAt: '2025-03-03T04:05:06.000Z',
  });
});

test('getFeature returns null profile and organization sidecars when their records are absent', async () => {
  const { response, body } = await request(getEndpoint, { uri: featureUris.newer });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.feature.uri, featureUris.newer);
  assert.equal(body.feature.author.did, unhydratedAuthor);
  assert.equal(body.feature.author.profile, null);
  assert.equal(body.feature.author.organization, null);
});

test('listFeatures combines repeated author and exact type filters without false positives', async () => {
  const { response, body } = await request(listEndpoint, {
    authors: [featureAuthor, profileOnlyAuthor],
    types: ['wetland', 'forest'],
    sortDirection: 'asc',
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.features.map(({ uri }) => uri), [
    featureUris.older,
    featureUris.alpha,
    featureUris.beta,
    featureUris.gamma,
  ]);
  assert.deepEqual(body.features.map(({ record }) => record.type), ['forest', 'wetland', 'wetland', 'wetland']);
  assert.equal(Object.hasOwn(body, 'cursor'), false);
});

test('listFeatures distinguishes authors with and without organization records', async () => {
  const filters = {
    authors: [featureAuthor, profileOnlyAuthor],
    types: ['wetland'],
    sortDirection: 'asc',
  };

  const withOrganization = await request(listEndpoint, { ...filters, hasOrganizationRecord: true });
  assert.equal(withOrganization.response.status, 200, JSON.stringify(withOrganization.body));
  assert.deepEqual(withOrganization.body.features.map(({ uri }) => uri), [featureUris.alpha, featureUris.beta]);
  assert.ok(withOrganization.body.features.every(({ author }) => author.organization?.uri === `at://${featureAuthor}/app.certified.actor.organization/self`));

  const withoutOrganization = await request(listEndpoint, { ...filters, hasOrganizationRecord: false });
  assert.equal(withoutOrganization.response.status, 200, JSON.stringify(withoutOrganization.body));
  assert.deepEqual(withoutOrganization.body.features.map(({ uri }) => uri), [featureUris.gamma]);
  assert.equal(withoutOrganization.body.features[0].author.profile.record.displayName, 'Forest Stewards');
  assert.equal(withoutOrganization.body.features[0].author.organization, null);
});

test('listFeatures paginates createdAt and URI ties in both directions without omissions', async () => {
  for (const [sortDirection, expected] of [
    ['asc', [featureUris.bog, featureUris.older, featureUris.alpha, featureUris.beta, featureUris.gamma, featureUris.newer]],
    ['desc', [featureUris.newer, featureUris.gamma, featureUris.beta, featureUris.alpha, featureUris.older, featureUris.bog]],
  ]) {
    let cursor;
    const collected = [];
    for (let offset = 0; offset < expected.length; offset += 2) {
      const params = { sortDirection, limit: 2, ...(cursor === undefined ? {} : { cursor }) };
      const { response, body } = await request(listEndpoint, params);
      assert.equal(response.status, 200, JSON.stringify(body));
      const page = expected.slice(offset, offset + 2);
      assert.deepEqual(body.features.map(({ uri }) => uri), page);
      collected.push(...body.features.map(({ uri }) => uri));

      const hasNextPage = offset + page.length < expected.length;
      assert.equal(Object.hasOwn(body, 'cursor'), hasNextPage);
      if (hasNextPage) {
        assert.equal(typeof body.cursor, 'string');
        cursor = body.cursor;
      }
    }
    assert.deepEqual(collected, expected);
  }
});

test('feature endpoints expose named request errors using the pinned HappyView runtime response', async () => {
  const invalidUri = await request(getEndpoint, {
    uri: 'at://alice.example/org.hypercerts.entity.feature/feature-missing',
  });
  assertNamedRuntimeError(invalidUri, getEndpoint, 'InvalidRequest');

  const missingFeature = await request(getEndpoint, {
    uri: `at://${featureAuthor}/${featureCollection}/feature-missing`,
  });
  assertNamedRuntimeError(missingFeature, getEndpoint, 'RecordNotFound');

  const invalidListRequest = await request(listEndpoint, { limit: 101 });
  assertNamedRuntimeError(invalidListRequest, listEndpoint, 'InvalidRequest');
});
