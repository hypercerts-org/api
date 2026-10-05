import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';
import { seedRows } from './fixtures/vocab-tags.fixture.js';

const getEndpoint = 'org.hypercerts.vocab.getVocabTag';
const listEndpoint = 'org.hypercerts.vocab.listVocabTags';
const primaryAuthor = 'did:web:vocab-author-a.example';
const secondaryAuthor = 'did:web:vocab-author-b.example';
const absentAuthor = 'did:web:vocab-absent.example';
const forestUri = `at://${primaryAuthor}/org.hypercerts.vocab.tag/climate.forest`;
const waterUri = `at://${primaryAuthor}/org.hypercerts.vocab.tag/climate.water`;
const riverUri = `at://${secondaryAuthor}/org.hypercerts.vocab.tag/climate.river`;
const coastUri = `at://${secondaryAuthor}/org.hypercerts.vocab.tag/climate.coast`;
const mangroveUri = 'at://did:web:vocab-author-c.example/org.hypercerts.vocab.tag/climate.mangrove';

async function request(endpoint, params = {}) {
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

async function getVocabTag(uri) {
  return request(getEndpoint, { uri });
}

async function listVocabTags(params = {}) {
  return request(listEndpoint, params);
}

function assertRuntimeError({ response, body }, endpoint, errorName) {
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, endpoint);
  assert.ok(body.message.includes(errorName), body.message);
}

test('getVocabTag returns the indexed record and hydrates publisher sidecars', async () => {
  const { response, body } = await getVocabTag(forestUri);
  assert.equal(response.status, 200, JSON.stringify(body));

  const seededTag = seedRows.find((row) => row.uri === forestUri);
  assert.ok(seededTag, `missing fixture row for ${forestUri}`);
  const { vocabTag } = body;
  assert.equal(vocabTag.uri, forestUri);
  // This literal CID is independently derived from the record's canonical DAG-CBOR bytes.
  assert.equal(vocabTag.cid, 'bafyreihcwktrg2ugtbmhnoanlcuwpshafv4omspstsxwdfrnp6bimfofu4');
  assert.equal(vocabTag.cid, seededTag.cid);
  assert.equal(vocabTag.indexedAt, '2025-02-04T05:06:07.000Z');
  assert.equal(vocabTag.did, primaryAuthor);
  assert.deepEqual(vocabTag.record, {
    $type: 'org.hypercerts.vocab.tag',
    key: 'forest',
    name: 'Forest cover',
    category: 'climate',
    status: 'accepted',
    createdAt: '2025-02-01T00:00:00.000Z',
    description: 'Areas covered by forest vegetation.',
  });
  assert.equal(vocabTag.author.did, primaryAuthor);
  assert.equal(vocabTag.author.profile.record.displayName, 'Vocabulary Publisher A');
  assert.deepEqual(vocabTag.author.organization.record.organizationType, ['nonprofit']);
});

test('getVocabTag returns null for publisher sidecars that are not indexed', async () => {
  const { response, body } = await getVocabTag(mangroveUri);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.vocabTag.uri, mangroveUri);
  assert.equal(body.vocabTag.author.did, 'did:web:vocab-author-c.example');
  assert.equal(body.vocabTag.author.profile, null);
  assert.equal(body.vocabTag.author.organization, null);
});

test('getVocabTag reports named not-found and invalid-request errors through HappyView', async () => {
  const missing = await getVocabTag('at://did:web:vocab-author-a.example/org.hypercerts.vocab.tag/not-indexed');
  assertRuntimeError(missing, getEndpoint, 'RecordNotFound');

  const invalid = await getVocabTag('at://did:web:vocab-author-a.example/org.hypercerts.collection/not-a-tag');
  assertRuntimeError(invalid, getEndpoint, 'InvalidRequest');
});

test('listVocabTags OR-filters repeated authors, defaults to descending order, and hydrates nullable sidecars', async () => {
  const { response, body } = await listVocabTags({ authors: [secondaryAuthor, primaryAuthor, secondaryAuthor] });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.vocabTags.map(({ uri }) => uri), [coastUri, riverUri, waterUri, forestUri]);
  assert.equal(body.vocabTags[0].author.did, secondaryAuthor);
  assert.equal(body.vocabTags[0].author.profile, null);
  assert.equal(body.vocabTags[0].author.organization, null);
  assert.equal(body.vocabTags[2].author.profile.record.displayName, 'Vocabulary Publisher A');
  assert.deepEqual(body.vocabTags[2].author.organization.record.organizationType, ['nonprofit']);
  assert.equal(Object.hasOwn(body, 'cursor'), false);

  const unmatched = await listVocabTags({ authors: absentAuthor });
  assert.equal(unmatched.response.status, 200, JSON.stringify(unmatched.body));
  assert.deepEqual(unmatched.body.vocabTags, []);
});

test('listVocabTags paginates timestamp ties in both directions without repeats or omissions', async () => {
  const directions = [
    {
      direction: 'asc',
      pages: [[forestUri, waterUri], [riverUri, coastUri], [mangroveUri]],
    },
    {
      direction: 'desc',
      pages: [[mangroveUri, coastUri], [riverUri, waterUri], [forestUri]],
    },
  ];

  for (const { direction, pages } of directions) {
    let cursor;
    for (const [index, expectedUris] of pages.entries()) {
      const { response, body } = await listVocabTags({
        sortDirection: direction,
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.deepEqual(body.vocabTags.map(({ uri }) => uri), expectedUris);
      if (index < pages.length - 1) {
        assert.equal(typeof body.cursor, 'string');
        cursor = body.cursor;
      } else {
        assert.equal(Object.hasOwn(body, 'cursor'), false);
      }
    }
  }
});

test('listVocabTags rejects unsupported search and invalid filters with named runtime errors', async () => {
  const invalidCases = [
    { params: { search: 'Forest' }, errorName: 'InvalidRequest' },
    { params: { authors: 'not-a-did' }, errorName: 'InvalidRequest' },
    { params: { limit: 101 }, errorName: 'InvalidRequest' },
  ];
  for (const { params, errorName } of invalidCases) {
    assertRuntimeError(await listVocabTags(params), listEndpoint, errorName);
  }
});
