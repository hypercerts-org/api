import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createReplayTransport, createTransport, executeCase, paginate, UnavailableEvidence } from '../../tooling/live-e2e/runtime.mjs';
import { filterValues, identity, matches } from '../../tooling/live-e2e/predicates.mjs';

test('budget counts failed transports and never starts an extra request', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'live-e2e-'));
  let calls = 0;
  const transport = createTransport({ target: 'https://example.test', budget: 1, interval: 0, directory,
    fetch: async () => { calls++; throw new Error('connection failed'); } });
  await assert.rejects(transport.request('app.certified.actor.listProfiles', {}), /connection failed/);
  await assert.rejects(transport.request('app.certified.actor.listProfiles', {}), /budget/);
  assert.equal(calls, 1);
  const evidence = JSON.parse(await readFile(path.join(directory, '000001.json'), 'utf8'));
  assert.equal(evidence.status, null);
  assert.match(evidence.error, /connection failed/);
});

test('GET transport preserves repeated values and percent-encodes spaces without redirects', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'live-e2e-'));
  let captured;
  const transport = createTransport({ target: 'https://example.test', budget: 1, interval: 0, directory,
    fetch: async (url, options) => { captured = { url: String(url), options }; return new Response('{"actors":[]}'); } });
  await transport.request('app.certified.actor.listOrganizations', { organizationTypes: ['Sin fines', 'Other'] });
  assert.match(captured.url, /organizationTypes=Sin%20fines&organizationTypes=Other/);
  assert.equal(captured.options.method, 'GET');
  assert.equal(captured.options.redirect, 'error');
});

test('offline replay preserves repeated query values and missing evidence cannot fetch', async () => {
  const evidenceDirectory = await mkdtemp(path.join(tmpdir(), 'live-e2e-replay-'));
  const nsid = 'app.certified.actor.getProfiles';
  const actors = ['did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'];
  const query = new URLSearchParams(actors.map(actor => ['actors', actor])).toString();
  await writeFile(path.join(evidenceDirectory, '000007.json'), JSON.stringify({
    sequence: 7, method: 'GET', url: `https://example.test/xrpc/${nsid}?${query}`,
    status: 200, body: '{"profiles":[]}',
  }));
  const replay = await createReplayTransport({ evidenceDirectory, target: 'https://example.test' });
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('network access forbidden'); };
  try {
    const response = await replay.request(nsid, { actors });
    assert.equal(response.sequence, 7);
    assert.deepEqual(response.body, { profiles: [] });
    await assert.rejects(replay.request(nsid, { actors: actors.slice(0, 2) }), UnavailableEvidence);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(replay.attempts, 0);
  assert.equal(replay.replayEvaluations, 2);
  assert.deepEqual(replay.evidenceSequences, [7]);
  assert.equal(networkCalls, 0);
});

test('malformed captured JSON is unavailable evidence with provenance and no network fallback', async () => {
  const evidenceDirectory = await mkdtemp(path.join(tmpdir(), 'live-e2e-malformed-replay-'));
  const filename = path.join(evidenceDirectory, '000007.json');
  const originalBody = '{"profiles":';
  await writeFile(filename, JSON.stringify({ sequence: 7, method: 'GET', url: 'https://example.test/xrpc/app.certified.actor.listProfiles?limit=100', status: 200, body: originalBody }));
  const originalCapture = await readFile(filename, 'utf8');
  const replay = await createReplayTransport({ evidenceDirectory, target: 'https://example.test' });
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('network access forbidden'); };
  try {
    await assert.rejects(replay.request('app.certified.actor.listProfiles', { limit: 100 }), error => {
      assert.ok(error instanceof UnavailableEvidence);
      assert.equal(error.sequence, 7);
      assert.equal(error.status, 200);
      assert.equal(error.replayEvaluation, 1);
      assert.deepEqual(error.requestEvidence, { sequence: 7, status: 200, replayEvaluation: 1 });
      assert.match(error.message, /malformed JSON body/);
      assert.match(error.message, /did not make a network request/);
      return true;
    });
    const outcome = await executeCase('malformed-capture', () => replay.request('app.certified.actor.listProfiles', { limit: 100 }));
    assert.equal(outcome.status, 'not-run', 'undecodable capture is unavailable evidence, not an endpoint assertion failure');
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(await readFile(filename, 'utf8'), originalCapture, 'replay must leave malformed capture bytes untouched');
  assert.equal(replay.attempts, 0);
  assert.equal(replay.replayEvaluations, 2);
  assert.deepEqual(replay.evidenceSequences, [7]);
  assert.equal(networkCalls, 0);
});

test('rate limiting stops later requests even when budget remains', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'live-e2e-'));
  let calls = 0;
  const transport = createTransport({ target: 'https://example.test', budget: 5, interval: 0, directory,
    fetch: async () => { calls++; return new Response('{"error":"RateLimitExceeded"}', { status: 429 }); } });
  await assert.rejects(transport.request('app.certified.actor.listProfiles', {}), /429/);
  await assert.rejects(transport.request('app.certified.actor.listProfiles', {}), /429/);
  assert.equal(calls, 1);
});

test('bounded pagination detects cross-page duplicates and preserves failing server cursors', async () => {
  const requests = [];
  await assert.rejects(paginate(async (params) => {
    requests.push(params);
    return requests.length === 1 ? { rows: [{ uri: 'a' }], cursor: 'server-token' } : { rows: [{ uri: 'a' }] };
  }, {}, { pages: 2, key: row => row.uri }), /duplicate/);
  assert.equal(requests[1].cursor, 'server-token');
  const partial = await paginate(async () => ({ rows: [{ uri: 'a' }], cursor: 'next' }), {}, { pages: 1, key: row => row.uri });
  assert.equal(partial.complete, false);
});

test('empty positive cases are data gaps; assertion failures remain failures', async () => {
  const missing = await executeCase('positive', async () => ({ status: 'insufficient-data', reason: 'no records' }));
  const failed = await executeCase('predicate', async () => { assert.fail('wrong author'); });
  assert.equal(missing.status, 'insufficient-data');
  assert.equal(failed.status, 'failed');
  assert.match(failed.reason, /wrong author/);
});

test('malformed optional identity and sidecar values remain unknown instead of crashing semantic readers', () => {
  const row = {
    uri: 42, did: { malformed: true }, record: { description: { text: 'not text' }, createdAt: 7, from: [null, 9], address: [{}] },
    profile: { record: null }, author: { organization: 'not a hydrated record' }, contributors: 'not-an-array',
  };
  assert.equal(identity(row), undefined);
  assert.deepEqual(filterValues(row, 'authors'), []);
  assert.deepEqual(filterValues(row, 'search'), []);
  assert.deepEqual(filterValues(row, 'before'), []);
  assert.deepEqual(filterValues(row, 'from'), []);
  assert.deepEqual(filterValues(row, 'addresses'), []);
  assert.deepEqual(filterValues(row, 'contributors'), []);
  assert.deepEqual(filterValues(row, 'hasOrganizationRecord'), []);
  assert.equal(matches(row, 'authors', 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa'), false);
});

test('collection tags use AND while subject unions and repeated authors use OR', () => {
  const row = { uri: 'at://did:plc:alice/org.hypercerts.collection/self', did: 'did:plc:alice', record: {
    tags: [{ uri: 'at://did:plc:alice/org.hypercerts.vocab.tag/a' }], subject: { did: 'did:plc:bob' }
  } };
  assert.equal(matches(row, 'authors', ['did:plc:other', 'did:plc:alice']), true);
  assert.equal(matches(row, 'tagUris', ['at://did:plc:alice/org.hypercerts.vocab.tag/a', 'at://did:plc:alice/org.hypercerts.vocab.tag/b']), false);
  assert.deepEqual(filterValues(row, 'subjects'), ['did:plc:bob']);
});
