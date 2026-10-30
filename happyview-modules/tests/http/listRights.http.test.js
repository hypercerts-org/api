import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const endpoint = 'org.hypercerts.claim.listRights';
const authorAlpha = 'did:web:rights-alpha.example';
const authorBravo = 'did:web:rights-bravo.example';
const authorCharlie = 'did:web:rights-charlie.example';
const rightsUris = {
  alphaFirst: `at://${authorAlpha}/org.hypercerts.claim.rights/3jzfcijpj2z2a`,
  alphaSecond: `at://${authorAlpha}/org.hypercerts.claim.rights/3jzfcijpj2z2b`,
  bravo: `at://${authorBravo}/org.hypercerts.claim.rights/3jzfcijpj2z2c`,
  charlie: `at://${authorCharlie}/org.hypercerts.claim.rights/3jzfcijpj2z2d`,
  outside: 'at://did:web:rights-outsider.example/org.hypercerts.claim.rights/3jzfcijpj2z2e',
};

async function listRights(params = {}) {
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

test('listRights ORs repeated authors and excludes records outside the requested publishers', async () => {
  const { response, body } = await listRights({
    authors: [authorAlpha, authorBravo],
    sortDirection: 'asc',
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.rights.map(({ uri }) => uri), [
    rightsUris.alphaFirst,
    rightsUris.alphaSecond,
    rightsUris.bravo,
  ]);
  assert.equal(body.rights[0].record.rightsName, 'All Rights Reserved');
  assert.equal(Object.hasOwn(body, 'cursor'), false);

  const absent = await listRights({ authors: ['did:web:rights-absent.example'] });
  assert.equal(absent.response.status, 200, JSON.stringify(absent.body));
  assert.deepEqual(absent.body.rights, []);
  assert.equal(Object.hasOwn(absent.body, 'cursor'), false);
});

test('listRights paginates createdAt ties by URI without repeats or omissions in both directions', async () => {
  const firstAsc = await listRights({ sortDirection: 'asc', limit: 2 });
  assert.equal(firstAsc.response.status, 200, JSON.stringify(firstAsc.body));
  assert.deepEqual(firstAsc.body.rights.map(({ uri }) => uri), [rightsUris.alphaFirst, rightsUris.alphaSecond]);
  assert.equal(typeof firstAsc.body.cursor, 'string');

  const secondAsc = await listRights({ sortDirection: 'asc', limit: 2, cursor: firstAsc.body.cursor });
  assert.equal(secondAsc.response.status, 200, JSON.stringify(secondAsc.body));
  assert.deepEqual(secondAsc.body.rights.map(({ uri }) => uri), [rightsUris.bravo, rightsUris.charlie]);
  assert.equal(typeof secondAsc.body.cursor, 'string');

  const thirdAsc = await listRights({ sortDirection: 'asc', limit: 2, cursor: secondAsc.body.cursor });
  assert.equal(thirdAsc.response.status, 200, JSON.stringify(thirdAsc.body));
  assert.deepEqual(thirdAsc.body.rights.map(({ uri }) => uri), [rightsUris.outside]);
  assert.equal(Object.hasOwn(thirdAsc.body, 'cursor'), false);

  const firstDesc = await listRights({ sortDirection: 'desc', limit: 2 });
  assert.equal(firstDesc.response.status, 200, JSON.stringify(firstDesc.body));
  assert.deepEqual(firstDesc.body.rights.map(({ uri }) => uri), [rightsUris.outside, rightsUris.charlie]);
  assert.equal(typeof firstDesc.body.cursor, 'string');

  const secondDesc = await listRights({ sortDirection: 'desc', limit: 2, cursor: firstDesc.body.cursor });
  assert.equal(secondDesc.response.status, 200, JSON.stringify(secondDesc.body));
  assert.deepEqual(secondDesc.body.rights.map(({ uri }) => uri), [rightsUris.bravo, rightsUris.alphaSecond]);
  assert.equal(typeof secondDesc.body.cursor, 'string');

  const thirdDesc = await listRights({ sortDirection: 'desc', limit: 2, cursor: secondDesc.body.cursor });
  assert.equal(thirdDesc.response.status, 200, JSON.stringify(thirdDesc.body));
  assert.deepEqual(thirdDesc.body.rights.map(({ uri }) => uri), [rightsUris.alphaFirst]);
  assert.equal(Object.hasOwn(thirdDesc.body, 'cursor'), false);
});

test('listRights exposes InvalidRequest using the pinned HappyView runtime error response', async () => {
  const { response, body } = await listRights({ limit: 101 });

  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, endpoint);
  assert.match(body.message, /InvalidRequest/);
});
