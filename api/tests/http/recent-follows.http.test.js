import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';
import { graphDids } from './fixtures/graph-follows.fixture.js';

const baseUrl = requireContractTarget();
const endpoint = 'app.certified.graph.listRecentFollows';
const accountFollow = 'app.certified.graph.follow';
const entityFollow = 'app.certified.graph.entityFollow';
const baselinePublisher = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const baselineOtherPublisher = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const baselineRecentUris = [
  `at://${baselinePublisher}/${accountFollow}/3jzfcijpj2z2a`,
  `at://${baselineOtherPublisher}/${accountFollow}/3jzfcijpj2z2g`,
  `at://${baselinePublisher}/${accountFollow}/3jzfcijpj2z2f`,
  `at://${baselinePublisher}/${accountFollow}/3jzfcijpj2z2e`,
  `at://${baselinePublisher}/${accountFollow}/3jzfcijpj2z2d`,
  `at://${baselinePublisher}/${accountFollow}/3jzfcijpj2z2c`,
  `at://${baselinePublisher}/${accountFollow}/3jzfcijpj2z2b`,
];
const olderGraphFollowUri = `at://${graphDids.secondPublisher}/${accountFollow}/3jzfcijpj2z2f`;

async function request(params = {}) {
  const response = await fetch(contractUrl(baseUrl, endpoint, params), {
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

test('listRecentFollows returns the exact global feed across tied-key pages, including baseline account follows', async () => {
  const expectedUris = [
    `at://${graphDids.secondPublisher}/${accountFollow}/3jzfcijpj2z2e`,
    `at://${graphDids.secondPublisher}/${entityFollow}/3jzfcijpj2z2e`,
    `at://${graphDids.publisher}/${accountFollow}/3jzfcijpj2z2d`,
    `at://${graphDids.publisher}/${accountFollow}/3jzfcijpj2z2c`,
    `at://${graphDids.publisher}/${accountFollow}/3jzfcijpj2z2b`,
    `at://${graphDids.publisher}/${accountFollow}/3jzfcijpj2z2a`,
    `at://${graphDids.publisher}/${entityFollow}/3jzfcijpj2z2d`,
    `at://${graphDids.publisher}/${entityFollow}/3jzfcijpj2z2c`,
    `at://${graphDids.publisher}/${entityFollow}/3jzfcijpj2z2b`,
    `at://${graphDids.publisher}/${entityFollow}/3jzfcijpj2z2a`,
    `at://${graphDids.thirdFollower}/${accountFollow}/3jzfcijpj2z2g`,
    `at://${graphDids.thirdFollower}/${entityFollow}/3jzfcijpj2z2f`,
    olderGraphFollowUri,
    ...baselineRecentUris,
  ];
  const records = [];
  let cursor;

  do {
    const { response, body } = await request({ limit: 5, cursor });
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.ok(body.follows.length > 0 && body.follows.length <= 5);
    records.push(...body.follows);
    cursor = body.cursor;
  } while (cursor);

  assert.deepEqual(records.map(({ uri }) => uri), expectedUris);
  assert.equal(records[0].record.$type, accountFollow);
  assert.equal(records[1].record.$type, entityFollow);
  assert.equal(records.filter(({ uri }) => uri === `at://${graphDids.publisher}/${accountFollow}/3jzfcijpj2z2a`).length, 1);
  assert.equal(records.filter(({ uri }) => uri === `at://${graphDids.publisher}/${accountFollow}/3jzfcijpj2z2b`).length, 1);
  assert.equal(records.find(({ uri }) => uri === `at://${graphDids.publisher}/${entityFollow}/3jzfcijpj2z2a`).indexedAt, '2025-03-01T00:00:00.000Z');
});

test('listRecentFollows applies before exclusively and preserves the complete older global result', async () => {
  const { response, body } = await request({ before: '2025-02-10T00:00:00.000Z', limit: 20 });

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.follows.map(({ uri }) => uri), [olderGraphFollowUri, ...baselineRecentUris]);
  assert.equal(Object.hasOwn(body, 'cursor'), false);
  assert.equal(body.follows[0].record.createdAt, '2025-02-09T00:00:00.000Z');

  const atOldestBound = await request({ before: '2025-02-09T00:00:00.000Z', limit: 20 });
  assert.equal(atOldestBound.response.status, 200, JSON.stringify(atOldestBound.body));
  assert.deepEqual(atOldestBound.body.follows.map(({ uri }) => uri), baselineRecentUris);
});

test('listRecentFollows input failures use the pinned HappyView runtime error response', async () => {
  const { response, body } = await request({ before: '2025-02-30T00:00:00.000Z' });

  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, endpoint);
  assert.match(body.message, /InvalidRequest/);
});
