import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const endpoint = 'org.hypercerts.collection.getCollection';
const authorDid = 'did:web:collections-author-a.example';
const collectionUri = `at://${authorDid}/org.hypercerts.collection/3jzfcijpj2z2a`;
const locationUri = `at://${authorDid}/app.certified.location/3jzfcijpj2z2a`;
const mangroveTagUri = `at://${authorDid}/org.hypercerts.vocab.tag/ecosystem-type.mangrove`;
const restorationTagUri = `at://${authorDid}/org.hypercerts.vocab.tag/outcome-class.restoration`;

async function getCollection(uri) {
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

test('getCollection returns the CBOR-addressed record and hydrates exact related versions', async () => {
  const { response, body } = await getCollection(collectionUri);
  assert.equal(response.status, 200, JSON.stringify(body));

  const { collection } = body;
  assert.equal(collection.uri, collectionUri);
  assert.equal(collection.cid, 'bafyreifcxdb4ed5rqu7jmqvopgp5jlfaagt3govrrcy3uub7amgrkszwae');
  assert.equal(collection.indexedAt, '2025-03-02T03:04:05.000Z');
  assert.equal(collection.did, authorDid);
  assert.equal(collection.record.title, 'Mangrove restoration portfolio');
  assert.equal(collection.author.did, authorDid);
  assert.equal(collection.author.profile.record.displayName, 'Collections Research Group');
  assert.equal(collection.author.organization, null);

  assert.equal(collection.location.uri, locationUri);
  assert.equal(collection.location.record.record.name, 'Southern mangrove reserve');
  assert.deepEqual(collection.tags.map(({ uri }) => uri), [mangroveTagUri, restorationTagUri, mangroveTagUri]);
  assert.deepEqual(collection.tags.map(({ record }) => record?.record.name ?? null), ['Mangrove', 'Restoration', null]);
  assert.deepEqual(collection.record.tags.map(({ uri }) => uri), [mangroveTagUri, restorationTagUri, mangroveTagUri]);
});

test('getCollection exposes RecordNotFound through the pinned HappyView runtime error response', async () => {
  const missingUri = `at://${authorDid}/org.hypercerts.collection/not-indexed`;
  const { response, body } = await getCollection(missingUri);

  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, endpoint);
  assert.match(body.message, /RecordNotFound/);
});
