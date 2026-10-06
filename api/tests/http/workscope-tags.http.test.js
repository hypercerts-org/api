import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const getEndpoint = 'org.hypercerts.workscope.getWorkscopeTag';
const listEndpoint = 'org.hypercerts.workscope.listWorkscopeTags';
const collection = 'org.hypercerts.workscope.tag';
const publisherA = 'did:web:workscope-a.example';
const publisherB = 'did:web:workscope-b.example';
const publisherC = 'did:web:workscope-c.example';
const tagUris = {
  tieA: `at://${publisherA}/${collection}/tag-tie-a`,
  tieZ: `at://${publisherA}/${collection}/tag-tie-z`,
  tieB: `at://${publisherB}/${collection}/tag-tie-b`,
  older: `at://${publisherA}/${collection}/tag-older`,
  unknownOffset: `at://${publisherA}/${collection}/tag-unknown-offset`,
  filterC: `at://${publisherC}/${collection}/tag-filter-c`,
};

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

function assertRuntimeScriptError({ response, body }, method, name) {
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, method);
  assert.ok(body.message.includes(name), `expected named ${name} error, got ${body.message}`);
}

test('getWorkscopeTag returns its CBOR-addressed record and hydrated publisher sidecars', async () => {
  const { response, body } = await request(getEndpoint, { uri: tagUris.tieA });
  assert.equal(response.status, 200, JSON.stringify(body));

  const { workscopeTag } = body;
  assert.equal(workscopeTag.uri, tagUris.tieA);
  assert.equal(workscopeTag.cid, 'bafyreihehozumc7xc5hwq2run4vez7757nw54zot7mfvozvr5v54pcug5u');
  assert.equal(workscopeTag.indexedAt, '2025-03-10T12:00:00.000Z');
  assert.equal(workscopeTag.did, publisherA);
  assert.deepEqual(workscopeTag.record, {
    $type: collection,
    key: 'shared_key',
    name: 'Shared key from A',
    createdAt: '2025-03-01T00:00:00Z',
  });
  assert.equal(workscopeTag.author.did, publisherA);
  assert.equal(workscopeTag.author.profile.uri, `at://${publisherA}/app.certified.actor.profile/self`);
  assert.deepEqual(workscopeTag.author.profile.record, {
    $type: 'app.certified.actor.profile',
    displayName: 'Workscope Test Publisher',
    description: 'Publisher profile for workscope-tag HTTP contracts.',
    createdAt: '2025-03-10T12:00:00.000Z',
  });
  assert.deepEqual(workscopeTag.author.organization.record, {
    $type: 'app.certified.actor.organization',
    organizationType: ['community'],
    visibility: 'public',
    createdAt: '2025-03-10T12:00:00.000Z',
  });
});

test('listWorkscopeTags ORs repeated author filters and omits unselected publishers', async () => {
  const { response, body } = await request(listEndpoint, {
    authors: [publisherA, publisherB],
    sortDirection: 'desc',
    limit: 10,
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.workscopeTags.map(({ uri }) => uri), [
    tagUris.tieB,
    tagUris.tieZ,
    tagUris.tieA,
    tagUris.unknownOffset,
    tagUris.older,
  ]);
  const unknownOffset = body.workscopeTags.find(({ uri }) => uri === tagUris.unknownOffset);
  const tieB = body.workscopeTags.find(({ uri }) => uri === tagUris.tieB);
  assert.ok(unknownOffset, 'the fallback record is included in the ordered results');
  assert.ok(tieB, 'the publisher with absent sidecars remains in the ordered results');
  assert.equal(unknownOffset.author.profile.record.displayName, 'Workscope Test Publisher');
  assert.deepEqual(unknownOffset.author.organization.record.organizationType, ['community']);
  assert.equal(tieB.author.profile, null);
  assert.equal(tieB.author.organization, null);
  assert.equal(Object.hasOwn(body, 'cursor'), false);
});

test('listWorkscopeTags falls back to indexedAt for an unknown-offset createdAt', async () => {
  const authors = [publisherA];
  const descending = await request(listEndpoint, { authors, limit: 10 });
  assert.equal(descending.response.status, 200, JSON.stringify(descending.body));
  assert.deepEqual(descending.body.workscopeTags.map(({ uri }) => uri), [
    tagUris.tieZ,
    tagUris.tieA,
    tagUris.unknownOffset,
    tagUris.older,
  ]);

  const ascending = await request(listEndpoint, { authors, sortDirection: 'asc', limit: 10 });
  assert.equal(ascending.response.status, 200, JSON.stringify(ascending.body));
  assert.deepEqual(ascending.body.workscopeTags.map(({ uri }) => uri), [
    tagUris.older,
    tagUris.unknownOffset,
    tagUris.tieA,
    tagUris.tieZ,
  ]);
  const unknownOffset = descending.body.workscopeTags.find(({ uri }) => uri === tagUris.unknownOffset);
  assert.ok(unknownOffset);
  assert.equal(unknownOffset.record.createdAt, '2025-03-02T00:00:00-00:00');
  assert.equal(unknownOffset.indexedAt, '2025-02-28T12:00:00.000Z');
});

test('getWorkscopeTag returns null sidecars when the publisher has no indexed profile or organization', async () => {
  const { response, body } = await request(getEndpoint, { uri: tagUris.tieB });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.workscopeTag.indexedAt, '2025-03-10T12:00:00.000Z');
  assert.equal(body.workscopeTag.author.did, publisherB);
  assert.equal(body.workscopeTag.author.profile, null);
  assert.equal(body.workscopeTag.author.organization, null);
});

test('getWorkscopeTag returns RecordNotFound as a named pinned-runtime error', async () => {
  const missingUri = `at://${publisherA}/${collection}/not-indexed`;
  assertRuntimeScriptError(await request(getEndpoint, { uri: missingUri }), getEndpoint, 'RecordNotFound');
});

test('getWorkscopeTag returns InvalidRequest for a different collection as a named pinned-runtime error', async () => {
  const wrongCollectionUri = `at://${publisherA}/app.certified.actor.profile/self`;
  assertRuntimeScriptError(await request(getEndpoint, { uri: wrongCollectionUri }), getEndpoint, 'InvalidRequest');
});

test('listWorkscopeTags returns no rows for an unmatched author filter', async () => {
  const { response, body } = await request(listEndpoint, {
    authors: ['did:web:workscope-no-match.example'],
    limit: 10,
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.workscopeTags, []);
  assert.equal(Object.hasOwn(body, 'cursor'), false);
});

test('listWorkscopeTags paginates tied timestamps in descending timestamp-and-URI order', async () => {
  const authors = [publisherA, publisherB];
  const first = await request(listEndpoint, { authors, limit: 2 });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.workscopeTags.map(({ uri }) => uri), [tagUris.tieB, tagUris.tieZ]);
  assert.equal(typeof first.body.cursor, 'string');

  const second = await request(listEndpoint, { authors, limit: 2, cursor: first.body.cursor });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.workscopeTags.map(({ uri }) => uri), [tagUris.tieA, tagUris.unknownOffset]);
  assert.equal(typeof second.body.cursor, 'string');

  const third = await request(listEndpoint, { authors, limit: 2, cursor: second.body.cursor });
  assert.equal(third.response.status, 200, JSON.stringify(third.body));
  assert.deepEqual(third.body.workscopeTags.map(({ uri }) => uri), [tagUris.older]);
  assert.equal(Object.hasOwn(third.body, 'cursor'), false);
  assert.deepEqual([...first.body.workscopeTags, ...second.body.workscopeTags, ...third.body.workscopeTags].map(({ uri }) => uri), [
    tagUris.tieB,
    tagUris.tieZ,
    tagUris.tieA,
    tagUris.unknownOffset,
    tagUris.older,
  ]);
});

test('listWorkscopeTags paginates tied timestamps in ascending timestamp-and-URI order', async () => {
  const authors = [publisherA, publisherB];
  const first = await request(listEndpoint, { authors, sortDirection: 'asc', limit: 2 });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.workscopeTags.map(({ uri }) => uri), [tagUris.older, tagUris.unknownOffset]);
  assert.equal(typeof first.body.cursor, 'string');

  const second = await request(listEndpoint, {
    authors,
    sortDirection: 'asc',
    limit: 2,
    cursor: first.body.cursor,
  });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.workscopeTags.map(({ uri }) => uri), [tagUris.tieA, tagUris.tieZ]);
  assert.equal(typeof second.body.cursor, 'string');

  const third = await request(listEndpoint, {
    authors,
    sortDirection: 'asc',
    limit: 2,
    cursor: second.body.cursor,
  });
  assert.equal(third.response.status, 200, JSON.stringify(third.body));
  assert.deepEqual(third.body.workscopeTags.map(({ uri }) => uri), [tagUris.tieB]);
  assert.equal(Object.hasOwn(third.body, 'cursor'), false);
  assert.deepEqual([...first.body.workscopeTags, ...second.body.workscopeTags, ...third.body.workscopeTags].map(({ uri }) => uri), [
    tagUris.older,
    tagUris.unknownOffset,
    tagUris.tieA,
    tagUris.tieZ,
    tagUris.tieB,
  ]);
});

test('listWorkscopeTags returns InvalidRequest as a named pinned-runtime error', async () => {
  assertRuntimeScriptError(await request(listEndpoint, { limit: 101 }), listEndpoint, 'InvalidRequest');
});
