import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const endpoint = 'org.hypercerts.collection.listCollectionItems';
const authorA = 'did:web:collections-author-a.example';
const authorB = 'did:web:collections-author-b.example';
const collectionUri = `at://${authorA}/org.hypercerts.collection/3jzfcijpj2z2a`;
const activityUri = `at://${authorB}/org.hypercerts.claim.activity/3jzfcijpj2z2b`;
const featureUri = `at://${authorB}/org.hypercerts.entity.feature/feature-restoration-zone`;
const nestedCollectionUri = `at://${authorB}/org.hypercerts.collection/3jzfcijpj2z2d`;

async function listCollectionItems(params) {
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

test('listCollectionItems preserves source order and resolves exact targets across pages', async () => {
  const first = await listCollectionItems({ collection: collectionUri, limit: 2 });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.items.map(({ itemIdentifier }) => itemIdentifier.uri), [activityUri, featureUri]);
  assert.deepEqual(first.body.items.map(({ itemWeight }) => itemWeight), ['1', '2']);
  assert.equal(first.body.items[0].record['$type'], 'org.hypercerts.claim.getActivity#activityView');
  assert.equal(first.body.items[0].record.record.title, 'Community mangrove planting');
  assert.deepEqual(first.body.items[0].record.author.organization.record.organizationType, ['community']);
  assert.equal(first.body.items[1].record['$type'], 'org.hypercerts.collection.listCollectionItems#featureView');
  assert.equal(first.body.items[1].record.record.title, 'Estuary restoration zone');
  assert.equal(first.body.items[1].record.author.profile, null);
  assert.equal(typeof first.body.cursor, 'string');

  const second = await listCollectionItems({ collection: collectionUri, limit: 2, cursor: first.body.cursor });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.items.map(({ itemIdentifier }) => itemIdentifier.uri), [nestedCollectionUri, activityUri]);
  assert.equal(second.body.items[0].record['$type'], 'org.hypercerts.collection.listCollectionItems#collectionSummaryView');
  assert.equal(second.body.items[0].record.title, 'River monitoring program');
  assert.equal(second.body.items[1].record, null, 'a matching URI with a different CID must remain unresolved');
  assert.notEqual(second.body.items[1].itemIdentifier.cid, first.body.items[0].itemIdentifier.cid);
  assert.equal(Object.hasOwn(second.body, 'cursor'), false);
});
