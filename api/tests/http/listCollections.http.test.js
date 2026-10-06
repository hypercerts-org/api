import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const endpoint = 'org.hypercerts.collection.listCollections';
const authorA = 'did:web:collections-author-a.example';
const authorB = 'did:web:collections-author-b.example';
const collectionUris = {
  main: `at://${authorA}/org.hypercerts.collection/3jzfcijpj2z2a`,
  overview: `at://${authorA}/org.hypercerts.collection/3jzfcijpj2z2b`,
  watershed: `at://${authorA}/org.hypercerts.collection/3jzfcijpj2z2c`,
  riverProgram: `at://${authorB}/org.hypercerts.collection/3jzfcijpj2z2d`,
};
const activityUri = `at://${authorB}/org.hypercerts.claim.activity/3jzfcijpj2z2b`;
const tagUris = {
  mangrove: `at://${authorA}/org.hypercerts.vocab.tag/ecosystem-type.mangrove`,
  restoration: `at://${authorA}/org.hypercerts.vocab.tag/outcome-class.restoration`,
};

async function listCollections(params = {}) {
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

test('listCollections applies author, organization, item, and conjunctive tag filters to indexed rows', async () => {
  const byAuthor = await listCollections({ authors: [authorA], sortDirection: 'asc' });
  assert.equal(byAuthor.response.status, 200, JSON.stringify(byAuthor.body));
  assert.deepEqual(byAuthor.body.collections.map(({ uri }) => uri), [
    collectionUris.main,
    collectionUris.overview,
    collectionUris.watershed,
  ]);

  const withOrganization = await listCollections({ hasOrganizationRecord: true });
  assert.equal(withOrganization.response.status, 200, JSON.stringify(withOrganization.body));
  assert.deepEqual(withOrganization.body.collections.map(({ uri }) => uri), [collectionUris.riverProgram]);

  const withoutOrganization = await listCollections({ hasOrganizationRecord: false, sortDirection: 'asc' });
  assert.equal(withoutOrganization.response.status, 200, JSON.stringify(withoutOrganization.body));
  assert.deepEqual(withoutOrganization.body.collections.map(({ uri }) => uri), [
    collectionUris.main,
    collectionUris.overview,
    collectionUris.watershed,
  ]);

  const byItem = await listCollections({ itemUris: [activityUri] });
  assert.equal(byItem.response.status, 200, JSON.stringify(byItem.body));
  assert.deepEqual(byItem.body.collections.map(({ uri }) => uri), [collectionUris.main]);

  const requiringBothTags = await listCollections({ tagUris: [tagUris.mangrove, tagUris.restoration] });
  assert.equal(requiringBothTags.response.status, 200, JSON.stringify(requiringBothTags.body));
  assert.deepEqual(requiringBothTags.body.collections.map(({ uri }) => uri), [collectionUris.main]);
});

test('listCollections paginates tied createdAt values by URI without duplicates or omissions', async () => {
  const first = await listCollections({
    authors: [authorA],
    types: ['project'],
    sortDirection: 'asc',
    limit: 2,
  });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.collections.map(({ uri }) => uri), [collectionUris.main, collectionUris.overview]);
  assert.equal(typeof first.body.cursor, 'string');

  const second = await listCollections({
    authors: [authorA],
    types: ['project'],
    sortDirection: 'asc',
    limit: 2,
    cursor: first.body.cursor,
  });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.collections.map(({ uri }) => uri), [collectionUris.watershed]);
  assert.equal(Object.hasOwn(second.body, 'cursor'), false);
});

test('listCollections applies type and exact-URI filters without an author filter', async () => {
  const byType = await listCollections({ types: ['project'], sortDirection: 'asc' });
  assert.equal(byType.response.status, 200, JSON.stringify(byType.body));
  assert.deepEqual(byType.body.collections.map(({ uri }) => uri), [
    collectionUris.main,
    collectionUris.overview,
    collectionUris.watershed,
  ]);

  const byExactUri = await listCollections({ uris: [collectionUris.main] });
  assert.equal(byExactUri.response.status, 200, JSON.stringify(byExactUri.body));
  assert.deepEqual(byExactUri.body.collections.map(({ uri }) => uri), [collectionUris.main]);
});

test('listCollections exposes InvalidRequest through the pinned HappyView runtime error response', async () => {
  const { response, body } = await listCollections({ limit: 101 });

  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, endpoint);
  assert.match(body.message, /InvalidRequest/);
});
