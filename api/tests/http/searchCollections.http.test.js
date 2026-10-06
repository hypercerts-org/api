import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const endpoint = 'org.hypercerts.collection.searchCollections';
const authorA = 'did:web:collections-author-a.example';
const collectionUris = {
  main: `at://${authorA}/org.hypercerts.collection/3jzfcijpj2z2a`,
  overview: `at://${authorA}/org.hypercerts.collection/3jzfcijpj2z2b`,
  watershed: `at://${authorA}/org.hypercerts.collection/3jzfcijpj2z2c`,
};

async function searchCollections(params) {
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

test('searchCollections trims and matches text while paginating tied createdAt values by URI', async () => {
  const first = await searchCollections({
    search: '  ReStOrAtIoN  ',
    authors: [authorA],
    sortDirection: 'asc',
    limit: 2,
  });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.collections.map(({ uri }) => uri), [collectionUris.main, collectionUris.overview]);
  assert.equal(typeof first.body.cursor, 'string');

  const second = await searchCollections({
    search: '  ReStOrAtIoN  ',
    authors: [authorA],
    sortDirection: 'asc',
    limit: 2,
    cursor: first.body.cursor,
  });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.collections.map(({ uri }) => uri), [collectionUris.watershed]);
  assert.equal(Object.hasOwn(second.body, 'cursor'), false);
});

test('searchCollections matches collection shortDescription as well as title', async () => {
  const { response, body } = await searchCollections({ search: 'COASTAL' });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.collections.map(({ uri }) => uri), [collectionUris.main]);
});

test('searchCollections matches title text that does not occur in shortDescription', async () => {
  const { response, body } = await searchCollections({ search: 'portfolio' });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.collections.map(({ uri }) => uri), [collectionUris.main]);
});
