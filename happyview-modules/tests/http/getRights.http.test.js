import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const endpoint = 'org.hypercerts.claim.getRights';
const rightsUri = 'at://did:web:rights-alpha.example/org.hypercerts.claim.rights/3jzfcijpj2z2a';
const rightsCid = 'bafyreiewrg2yr37zuby3cxg5qywyfu5zucz2dc3tgru6yfrms53h4ckite';

async function getRights(uri) {
  const url = contractUrl(requireContractTarget(), endpoint, { uri });
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

test('getRights returns the requested CBOR-addressed record and nullable missing sidecars', async () => {
  const { response, body } = await getRights(rightsUri);
  assert.equal(response.status, 200, JSON.stringify(body));

  const { rights } = body;
  assert.equal(rights.uri, rightsUri);
  assert.equal(rights.cid, rightsCid);
  assert.equal(rights.indexedAt, '2025-02-03T04:06:00.000Z');
  assert.equal(rights.did, 'did:web:rights-alpha.example');
  assert.deepEqual(rights.record, {
    $type: 'org.hypercerts.claim.rights',
    rightsName: 'All Rights Reserved',
    rightsType: 'ARR',
    rightsDescription: 'Permission terms are retained in full.',
    createdAt: '2025-02-01T00:00:00.000Z',
  });
  assert.equal(rights.author.did, 'did:web:rights-alpha.example');
  assert.equal(rights.author.profile, null);
  assert.equal(rights.author.organization, null);
});

test('getRights exposes RecordNotFound using the pinned HappyView runtime error response', async () => {
  const missingUri = 'at://did:web:rights-alpha.example/org.hypercerts.claim.rights/3jzfcijpj2z2z';
  const { response, body } = await getRights(missingUri);

  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, endpoint);
  assert.match(body.message, /RecordNotFound/);
});

test('getRights exposes InvalidRequest using the pinned HappyView runtime error response', async () => {
  const wrongCollection = 'at://did:web:rights-alpha.example/app.certified.location/3jzfcijpj2z2a';
  const { response, body } = await getRights(wrongCollection);

  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, endpoint);
  assert.match(body.message, /InvalidRequest/);
});
