import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const receiptUri = 'at://did:plc:abcdefghijklmnopqrstuvwx/org.hypercerts.funding.receipt/receipt-a';
const collection = 'org.hypercerts.funding.receipt';

async function getReceipt(uri) {
  const url = contractUrl(requireContractTarget(), 'org.hypercerts.funding.getReceipt', { uri });
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

test('getReceipt returns the indexed record and hydrates its publisher sidecars', async () => {
  const { response, body } = await getReceipt(receiptUri);
  assert.equal(response.status, 200, JSON.stringify(body));

  const { receipt } = body;
  assert.equal(receipt.uri, receiptUri);
  assert.equal(receipt.did, 'did:plc:abcdefghijklmnopqrstuvwx');
  assert.equal(receipt.indexedAt, '2025-02-01T00:00:00.000Z');
  assert.equal(receipt.record.$type, collection);
  assert.equal(receipt.record.amount, '0012345678901234567890.00000001');
  assert.equal(receipt.record.transactionId, 'Tx-CaseSensitive');
  assert.deepEqual(receipt.record.from, {
    $type: 'app.certified.defs#did',
    did: 'did:plc:cccccccccccccccccccccccc',
  });
  assert.deepEqual(receipt.record.for, {
    $type: 'com.atproto.repo.strongRef',
    uri: 'at://did:plc:ffffffffffffffffffffffff/org.hypercerts.claim.activity/target',
    cid: 'bafyreidr6dv5qtbrfubummgssjqfow3eavqwnihvmectr63yalrnu4yqea',
  });
  assert.equal(receipt.author.did, 'did:plc:abcdefghijklmnopqrstuvwx');
  assert.equal(receipt.author.profile.record.displayName, 'Test Publisher');
  assert.deepEqual(receipt.author.organization.record.organizationType, ['nonprofit']);
});

test('getReceipt exposes RecordNotFound using the pinned HappyView runtime error response', async () => {
  const missingUri = 'at://did:plc:abcdefghijklmnopqrstuvwx/org.hypercerts.funding.receipt/not-indexed';
  const { response, body } = await getReceipt(missingUri);
  // The pinned HappyView release serializes ordinary Lua errors as runtime script_error responses.
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, 'org.hypercerts.funding.getReceipt');
  assert.match(body.message, /RecordNotFound/);
});
