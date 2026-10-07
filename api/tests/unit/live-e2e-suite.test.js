import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalogue } from '../../tooling/live-e2e/catalogue.mjs';
import { createReplayTransport, createTransport } from '../../tooling/live-e2e/runtime.mjs';
import { runSuite } from '../../tooling/live-e2e/suite.mjs';

const cid = 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const profile = (letter, time) => ({
  uri: `at://did:plc:${letter.repeat(24)}/app.certified.actor.profile/self`,
  did: `did:plc:${letter.repeat(24)}`, cid, indexedAt: time,
  record: { $type: 'app.certified.actor.profile', createdAt: time, displayName: `Actor ${letter}` },
});
const alice = profile('a', '2026-01-02T00:00:00Z');
const bob = profile('b', '2026-01-01T00:00:00Z');
const graphPublisher = `did:plc:${'p'.repeat(24)}`;
const graphDid = letter => `did:plc:${letter.repeat(24)}`;
const graphFollow = ({ key, subject, createdAt }) => ({
  uri: `at://${graphPublisher}/app.certified.graph.follow/${key}`, cid,
  indexedAt: createdAt, did: graphPublisher,
  record: { $type: 'app.certified.graph.follow', createdAt, subject: graphDid(subject) },
});
const graphFollowingView = (follow, organizationAt = follow.record.createdAt) => {
  const did = follow.record.subject;
  return {
    did, profile: null,
    organization: organizationAt === null ? null : {
      uri: `at://${did}/app.certified.actor.organization/self`, cid,
      indexedAt: organizationAt, did,
      record: { $type: 'app.certified.actor.organization', createdAt: organizationAt },
    },
    follow,
  };
};
const graphOrderRows = [
  { key: 'a', subject: 'm', createdAt: '2025-01-01T00:00:00Z', organizationAt: '2025-01-04T00:00:00Z' },
  { key: 'b', subject: 'z', createdAt: '2025-01-02T00:00:00Z', organizationAt: '2025-01-02T00:00:00Z' },
  { key: 'c', subject: 'a', createdAt: '2025-01-02T00:00:00Z', organizationAt: '2025-01-02T00:00:00Z' },
  { key: 'd', subject: 't', createdAt: '2025-01-03T00:00:00Z', organizationAt: '2025-01-01T00:00:00Z' },
].map(row => {
  const follow = graphFollow(row);
  return graphFollowingView(follow, row.organizationAt);
});
const evaluationDid = `did:plc:${'e'.repeat(24)}`;
const evaluationRow = (rkey, evaluator) => ({
  uri: `at://${evaluationDid}/org.hypercerts.context.evaluation/${rkey}`, cid,
  indexedAt: '2026-01-03T00:00:00Z', did: evaluationDid,
  author: { did: evaluationDid, profile: null, organization: null },
  record: {
    $type: 'org.hypercerts.context.evaluation', createdAt: '2026-01-02T00:00:00Z',
    evaluators: [evaluator], summary: 'Evaluation fixture',
    subject: { $type: 'com.atproto.repo.strongRef', uri: `at://${evaluationDid}/org.hypercerts.claim.activity/3test`, cid },
  },
  evaluators: [{ did: evaluationDid, hydrationStatus: 'hydrated', profile: null, organization: null }],
});

async function run(endpointName, reply) {
  const catalogue = await loadCatalogue();
  const selected = catalogue.endpoints.filter(endpoint => endpoint.nsid === endpointName);
  const directory = await mkdtemp(path.join(tmpdir(), 'live-suite-'));
  const transport = { attempts: 0, async request(nsid, params) {
    this.attempts++;
    const response = reply(nsid, params);
    return response && Object.hasOwn(response, 'status') && Object.hasOwn(response, 'body')
      ? { sequence: this.attempts, ...response }
      : { sequence: this.attempts, status: 200, body: response };
  } };
  const report = await runSuite({ catalogue, selected, transport, directory, discoveryPages: 1 });
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8')).counts, report.counts);
  return report;
}

test('live runner catches ignored actor filters and a known-positive omission, not just HTTP 200', async () => {
  for (const [body, symptom] of [[{ profiles: [alice, bob] }, /violates actors/], [{ profiles: [] }, /Filter omitted/]]) {
    const report = await run('app.certified.actor.searchProfiles', (nsid, params) => {
      if (nsid.endsWith('listProfiles') || !params.actors) return { profiles: [alice, bob] };
      return body;
    });
    const result = report.results.find(outcome => outcome.id.endsWith('/filters/actors'));
    assert.equal(result.status, 'failed');
    assert.match(result.reason, symptom);
  }
});

test('a changed server-issued cursor replay is reported as a failure', async () => {
  const carol = profile('c', '2025-12-31T00:00:00Z');
  const dan = profile('d', '2025-12-30T00:00:00Z');
  let continuations = 0;
  const report = await run('app.certified.actor.listProfiles', (nsid, params) => {
    if (params.cursor === 'server-issued') {
      continuations++;
      return { profiles: continuations === 1 ? [carol, dan] : [dan, carol] };
    }
    if (params.limit === 2) return { profiles: [alice, bob], cursor: 'server-issued' };
    return { profiles: [alice, bob, carol, dan] };
  });
  const result = report.results.find(outcome => outcome.id.endsWith('/pagination/asc'));
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /Cursor replay changed/);
});

test('graph pagination orders follow records, not conflicting organization sidecars', async () => {
  const report = await run('app.certified.graph.listActorFollowing', (nsid, params) => {
    if (nsid === 'app.certified.graph.listRecentFollows') return { follows: graphOrderRows.map(row => row.follow) };
    if (params.limit === 101 || params.cursor === 'not-a-valid-cursor') return { status: 400, body: { error: 'InvalidRequest' } };
    const rows = params.sortDirection === 'asc' ? graphOrderRows : [...graphOrderRows].reverse();
    const offset = params.cursor ? 2 : 0;
    const limit = params.limit ?? 25;
    const following = rows.slice(offset, offset + limit);
    return {
      following, totalCount: rows.length,
      ...(offset + limit < rows.length ? { cursor: 'following-next' } : {}),
    };
  });

  for (const direction of ['asc', 'desc']) {
    const result = report.results.find(item => item.id.endsWith(`/pagination/${direction}`));
    assert.equal(result.status, 'passed', result.reason);
  }
});

test('graph pagination detects a repeated follow when sidecar hydration changes', async () => {
  const rows = [
    graphFollowingView(graphFollow({ key: 'a', subject: 'm', createdAt: '2025-01-01T00:00:00Z' })),
    graphFollowingView(graphFollow({ key: 'b', subject: 'z', createdAt: '2025-01-02T00:00:00Z' }), '2025-01-01T12:00:00Z'),
    graphFollowingView(graphFollow({ key: 'c', subject: 'a', createdAt: '2025-01-03T00:00:00Z' })),
  ];
  const repeatedB = { ...rows[1], organization: null };
  const combined = [rows[0], rows[1], repeatedB, rows[2]];
  const report = await run('app.certified.graph.listActorFollowing', (nsid, params) => {
    if (nsid === 'app.certified.graph.listRecentFollows') return { follows: rows.map(row => row.follow) };
    if (params.limit === 101 || params.cursor === 'not-a-valid-cursor') return { status: 400, body: { error: 'InvalidRequest' } };
    if (params.sortDirection === 'asc' && params.cursor) return { following: [repeatedB, rows[2]], totalCount: 3 };
    if (params.sortDirection === 'asc' && params.limit === 2) return { following: rows.slice(0, 2), totalCount: 3, cursor: 'following-next' };
    if (params.sortDirection === 'asc' && params.limit === 4) return { following: combined, totalCount: 3 };
    const ordered = params.sortDirection === 'asc' ? rows : [...rows].reverse();
    const limit = params.limit ?? 25;
    return { following: ordered.slice(0, limit), totalCount: rows.length };
  });

  const result = report.results.find(item => item.id.endsWith('/pagination/asc'));
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /Pagination duplicated a record/);
});

test('evaluator anchors require contract-shaped DID objects and valid omissions still fail', async () => {
  const scenarios = [
    {
      name: 'malformed bare evaluator strings are not positive anchors',
      row: evaluationRow('3test1', evaluationDid),
      status: 'insufficient-data',
      schemaFinding: true,
    },
    {
      name: 'a valid evaluator DID object remains a positive anchor',
      row: evaluationRow('3test2', { $type: 'app.certified.defs#did', did: evaluationDid }),
      status: 'failed',
      schemaFinding: false,
    },
  ];
  for (const scenario of scenarios) {
    const report = await run('org.hypercerts.context.listEvaluations', (nsid, params) => {
      if (params.limit === 101 || params.cursor === 'not-a-valid-cursor') return { status: 400, body: { error: 'InvalidRequest' } };
      if (params.evaluators) return { evaluations: [] };
      return { evaluations: [scenario.row] };
    });
    const result = report.results.find(item => item.id.endsWith('/filters/evaluators'));
    assert.equal(result.status, scenario.status, scenario.name);
    if (scenario.schemaFinding) {
      assert.ok(report.schemaFindings.some(finding => /evaluators\/0/.test(finding.reason)), 'full schema validation must still flag the malformed record');
    } else {
      assert.match(result.reason, /Filter omitted/, scenario.name);
    }
  }
});

test('batch roundtrips preserve duplicate actor occurrences and their raw records', async () => {
  const report = await run('app.certified.actor.getProfiles', (nsid, params) => {
    if (nsid.endsWith('listProfiles')) return { profiles: [alice, bob] };
    assert.deepEqual(params.actors, [alice.did, bob.did, alice.did]);
    return { profiles: [
      { actor: alice.did, profile: alice },
      { actor: bob.did, profile: bob },
      { actor: alice.did, profile: alice },
    ] };
  });
  assert.equal(report.results.find(result => result.id.endsWith('/roundtrip')).status, 'passed');
});

test('mixed malformed discovery keeps usable filter anchors while preserving its schema failure', async () => {
  const malformed = { ...bob, record: { ...bob.record, description: 'x'.repeat(257) } };
  const report = await run('app.certified.actor.searchProfiles', (nsid, params) => {
    if (nsid === 'app.certified.actor.listProfiles') return { profiles: [alice, malformed] };
    if (params.limit === 101 || params.cursor === 'not-a-valid-cursor') return { status: 400, body: { error: 'InvalidRequest' } };
    if (params.limit === 1) return { profiles: [alice] };
    if (params.actors?.length > 1) return { profiles: [alice, malformed] };
    if (params.actors) return { profiles: [alice] };
    if (params.search) return { profiles: [alice] };
    return { profiles: [alice, bob] };
  });

  assert.equal(report.results.find(result => result.id.endsWith('/baseline')).status, 'passed');
  assert.equal(report.results.find(result => result.id.endsWith('/filters/actors')).status, 'passed');
  assert.ok(report.schemaFindings.some(finding => finding.endpoint === 'app.certified.actor.listProfiles'));
  assert.ok(report.results.find(result => result.id.endsWith('/filters/actors')).requestEvidence
    .some(request => request.endpoint === 'app.certified.actor.searchProfiles'));
});

test('failed source structure is attributed to the source while independent bounds still run', async () => {
  const report = await run('app.certified.actor.searchProfiles', (nsid, params) => {
    if (nsid === 'app.certified.actor.listProfiles') return { profiles: 'not-an-array' };
    if (params.limit === 1) return { profiles: [alice] };
    return { profiles: [alice, bob] };
  });
  const source = report.sourceObservations.find(observation => observation.endpoint === 'app.certified.actor.listProfiles');
  const filter = report.results.find(result => result.id.endsWith('/filters/actors'));
  const limit = report.results.find(result => result.id.endsWith('/limit/1'));
  assert.equal(source.status, 'failed');
  assert.equal(source.requestEvidence[0].endpoint, 'app.certified.actor.listProfiles');
  assert.equal(filter.status, 'not-run');
  assert.deepEqual(filter.sourceObservationIds, [source.id]);
  assert.deepEqual(filter.requestEvidence, []);
  assert.equal(limit.status, 'passed');
  assert.equal(limit.requestEvidence[0].endpoint, 'app.certified.actor.searchProfiles');
});

test('budget-blocked runner cases do not inherit the prior started request sequence', async () => {
  const catalogue = await loadCatalogue();
  const selected = catalogue.endpoints.filter(endpoint => endpoint.nsid === 'app.certified.actor.searchProfiles');
  const evidenceDirectory = await mkdtemp(path.join(tmpdir(), 'live-budget-evidence-'));
  const reportDirectory = await mkdtemp(path.join(tmpdir(), 'live-budget-report-'));
  let fetchCalls = 0;
  const transport = createTransport({ target: 'https://example.test', budget: 1, interval: 0, directory: evidenceDirectory,
    fetch: async () => { fetchCalls++; return new Response(JSON.stringify({ profiles: [alice, bob] })); } });
  const report = await runSuite({ catalogue, selected, transport, directory: reportDirectory, discoveryPages: 1 });
  const baseline = report.results.find(result => result.id.endsWith('/baseline'));
  const blockedFilter = report.results.find(result => result.id.endsWith('/filters/search'));
  const blockedLimit = report.results.find(result => result.id.endsWith('/limit/1'));
  const source = report.sourceObservations.find(observation => observation.endpoint === 'app.certified.actor.listProfiles');

  assert.equal(baseline.status, 'passed');
  assert.equal(baseline.requestEvidence[0].sequence, 1);
  assert.deepEqual(baseline.requestEvidence[0].params, { search: '' });
  assert.equal(blockedFilter.status, 'not-run');
  assert.equal(source.status, 'not-run');
  assert.equal(source.requestEvidence[0].endpoint, 'app.certified.actor.listProfiles');
  assert.deepEqual(source.requestEvidence[0].params, { limit: 100 });
  assert.equal(source.requestEvidence[0].sequence, null);
  assert.equal(source.requestEvidence[0].status, null);
  assert.equal(blockedLimit.status, 'not-run');
  assert.equal(blockedLimit.requestEvidence[0].endpoint, 'app.certified.actor.searchProfiles');
  assert.deepEqual(blockedLimit.requestEvidence[0].params, { search: '', limit: 1 });
  assert.equal(blockedLimit.requestEvidence[0].sequence, null);
  assert.equal(transport.attempts, 1);
  assert.equal(fetchCalls, 1);
});

test('malformed identity candidates are skipped in favor of a schema-valid lookup anchor', async () => {
  const malformed = { ...bob, uri: 'not-an-at-uri', did: 'not-a-did', cid: 13, record: { ...bob.record, description: 'x'.repeat(257) } };
  const report = await run('app.certified.actor.getProfile', (nsid, params) => {
    if (nsid === 'app.certified.actor.listProfiles') return { profiles: [malformed, alice] };
    assert.equal(params.actor, alice.did, 'lookup must use the later schema-valid DID, not a malformed identity');
    return { profile: alice };
  });
  assert.equal(report.results.find(result => result.id.endsWith('/baseline')).status, 'passed');
  assert.equal(report.results.find(result => result.id.endsWith('/roundtrip')).status, 'passed');
  assert.ok(report.schemaFindings.some(finding => finding.endpoint === 'app.certified.actor.listProfiles'));
});

test('offline replay retains partial discovery anchors and findings without fetching unavailable requests', async () => {
  const evidenceDirectory = await mkdtemp(path.join(tmpdir(), 'live-replay-evidence-'));
  const reportDirectory = await mkdtemp(path.join(tmpdir(), 'live-replay-report-'));
  const malformed = { ...bob, record: { ...bob.record, description: 'x'.repeat(257) } };
  async function capture(sequence, nsid, query, body) {
    await writeFile(path.join(evidenceDirectory, `${String(sequence).padStart(6, '0')}.json`), JSON.stringify({
      sequence, method: 'GET', url: `https://api.hypercerts.dev/xrpc/${nsid}${query ? `?${query}` : ''}`,
      status: 200, body: JSON.stringify(body),
    }));
  }
  const repeated = new URLSearchParams([['search', ''], ['actors', alice.did], ['actors', bob.did], ['limit', '100']]).toString();
  await capture(1, 'app.certified.actor.listProfiles', 'limit=100', { profiles: [alice, malformed], cursor: 'source-next' });
  await capture(2, 'app.certified.actor.searchProfiles', 'search=', { profiles: [alice, malformed] });
  await capture(3, 'app.certified.actor.searchProfiles', 'search=Actor%20a&limit=100', { profiles: [alice] });
  await capture(4, 'app.certified.actor.searchProfiles', `search=&actors=${encodeURIComponent(alice.did)}&limit=100`, { profiles: [alice] });
  await capture(5, 'app.certified.actor.searchProfiles', repeated, { profiles: [alice, malformed] });

  const catalogue = await loadCatalogue();
  const selected = catalogue.endpoints.filter(endpoint => endpoint.nsid === 'app.certified.actor.searchProfiles');
  const transport = await createReplayTransport({ evidenceDirectory, target: 'https://api.hypercerts.dev' });
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('network access forbidden in replay test'); };
  let report;
  try { report = await runSuite({ catalogue, selected, transport, directory: reportDirectory, discoveryPages: 2 }); }
  finally { globalThis.fetch = originalFetch; }

  const baseline = report.results.find(result => result.id.endsWith('/baseline'));
  const search = report.results.find(result => result.id.endsWith('/filters/search'));
  const actors = report.results.find(result => result.id.endsWith('/filters/actors'));
  const multiple = report.results.find(result => result.id.endsWith('/multi/actors'));
  const missing = report.results.find(result => result.id.endsWith('/filters/search+actors'));
  assert.equal(report.attempts, 0);
  assert.ok(report.replayEvaluations > report.evidenceSequencesUsed.length);
  const source = report.sourceObservations[0];
  assert.equal(source.status, 'partial');
  assert.equal(source.complete, false);
  assert.equal(source.records, 2);
  assert.equal(source.pagesObserved, 1);
  assert.match(source.reason, /No captured GET evidence/);
  assert.equal(source.incompleteCause.type, 'unavailable-evidence');
  assert.equal(source.incompleteCause.name, 'UnavailableEvidence');
  assert.equal(source.incompleteCause.requestEvidence.sequence, null);
  assert.ok(source.schemaFindingIds.length > 0);
  assert.equal(source.requestEvidence[1].sequence, null);
  assert.equal(source.requestEvidence[1].unavailableEvidence, true);
  assert.equal(source.requestEvidence[1].params.cursor, 'source-next');
  assert.ok(report.schemaFindings.some(finding => finding.endpoint === 'app.certified.actor.listProfiles'));
  assert.equal(baseline.status, 'passed');
  assert.equal(search.status, 'passed');
  assert.equal(actors.status, 'passed');
  assert.deepEqual(actors.requestEvidence[0].params.actors, [alice.did], 'dependent selected request must use the retained first-page anchor');
  assert.equal(multiple.status, 'passed');
  assert.equal(multiple.requestEvidence[0].replayed, true);
  assert.equal(missing.status, 'not-run');
  assert.match(missing.reason, /No captured GET evidence/);
  assert.equal(networkCalls, 0);
});

for (const scenario of [
  { name: 'missing continuation remains incomplete when dependent lookup cases pass', continuation: null, exitCode: 2, causeStatus: 'not-run', sourceFailures: 0, sequence: null, status: null },
  { name: 'HTTP 500 continuation counts as a failed source while dependent lookup cases pass', continuation: { status: 500, body: { error: 'InternalServerError' } }, exitCode: 1, causeStatus: 'failed', sourceFailures: 1, sequence: 2, status: 500 },
]) {
  test(scenario.name, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'live-partial-cli-'));
    const evidenceDirectory = path.join(root, 'evidence');
    const reportDirectory = path.join(root, 'report');
    await mkdir(evidenceDirectory);
    await writeFile(path.join(evidenceDirectory, 'plan.json'), JSON.stringify({ target: 'https://example.test', discoveryPages: 2,
      endpoints: [{ nsid: 'app.certified.actor.getProfile', source: 'app.certified.actor.listProfiles' }] }));
    const capture = async (sequence, nsid, params, status, body) => {
      const query = new URLSearchParams(params).toString();
      await writeFile(path.join(evidenceDirectory, `${String(sequence).padStart(6, '0')}.json`), JSON.stringify({ sequence, method: 'GET',
        url: `https://example.test/xrpc/${nsid}${query ? `?${query}` : ''}`, status, body: JSON.stringify(body) }));
    };
    await capture(1, 'app.certified.actor.listProfiles', { limit: 100 }, 200, { profiles: [alice], cursor: 'next-page' });
    if (scenario.continuation) await capture(2, 'app.certified.actor.listProfiles', { limit: 100, cursor: 'next-page' }, scenario.continuation.status, scenario.continuation.body);
    await capture(scenario.continuation ? 3 : 2, 'app.certified.actor.getProfile', { actor: alice.did }, 200, { profile: alice });

    const cli = fileURLToPath(new URL('../../tooling/live-e2e/cli.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [cli, '--replay', evidenceDirectory, '--out', reportDirectory], { encoding: 'utf8' });
    assert.equal(result.status, scenario.exitCode, result.stderr);
    const report = JSON.parse(await readFile(path.join(reportDirectory, 'report.json'), 'utf8'));
    const source = report.sourceObservations[0];
    assert.equal(report.attempts, 0);
    assert.deepEqual(report.counts, { passed: 2 });
    assert.deepEqual(report.results.map(item => item.status), ['passed', 'passed']);
    assert.equal(report.schemaFindings.length, 0);
    assert.equal(source.status, 'partial');
    assert.equal(source.complete, false);
    assert.equal(source.incompleteCause.status, scenario.causeStatus);
    assert.equal(source.requestEvidence[1].sequence, scenario.sequence);
    assert.equal(source.requestEvidence[1].status, scenario.status);
    assert.equal(report.sourceFailures, scenario.sourceFailures);
    assert.match(await readFile(path.join(reportDirectory, 'report.md'), 'utf8'), new RegExp(`Failed shared sources: ${scenario.sourceFailures}`));
    assert.match(result.stdout, new RegExp(`${scenario.sourceFailures} failed sources, 1 partial sources`));
  });
}

test('empty evaluation data produces gaps while successful bound checks remain distinct', async () => {
  const report = await run('org.hypercerts.context.listEvaluations', () => ({ evaluations: [] }));
  assert.equal(report.results.find(result => result.id.endsWith('/filters/evaluators')).status, 'insufficient-data');
  assert.equal(report.results.find(result => result.id.endsWith('/pagination/desc')).status, 'insufficient-data');
  assert.equal(report.results.find(result => result.id.endsWith('/limit/1')).status, 'passed');
  assert.equal(report.results.find(result => result.id.endsWith('/invalid/limit')).status, 'failed');
});
