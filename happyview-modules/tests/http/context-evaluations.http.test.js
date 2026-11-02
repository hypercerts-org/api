import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const getEndpoint = 'org.hypercerts.context.getEvaluation';
const listEndpoint = 'org.hypercerts.context.listEvaluations';
const authorA = 'did:web:context-evaluation-a.invalid';
const malformedAuthor = 'did:web:context-evaluation-malformed.invalid';
const evaluatorA = 'did:web:context-evaluator-a.invalid';
const evaluatorD = 'did:web:context-evaluator-d.invalid';
const legacyEvaluatorDid = 'did:web:context-evaluator-legacy.invalid';
const evaluationUris = {
  a: `at://${authorA}/org.hypercerts.context.evaluation/3jzfcijpj2z2a`,
  b: `at://${authorA}/org.hypercerts.context.evaluation/3jzfcijpj2z2b`,
  c: 'at://did:web:context-evaluation-b.invalid/org.hypercerts.context.evaluation/3jzfcijpj2z2c',
  d: 'at://did:web:context-evaluation-b.invalid/org.hypercerts.context.evaluation/3jzfcijpj2z2d',
  e: `at://${malformedAuthor}/org.hypercerts.context.evaluation/3jzfcijpj2z2e`,
  f: `at://${malformedAuthor}/org.hypercerts.context.evaluation/3jzfcijpj2z2f`,
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

test('getEvaluation preserves the CBOR-addressed record and hydrates publisher and evaluator views', async () => {
  const { response, body } = await request(getEndpoint, { uri: evaluationUris.a });
  assert.equal(response.status, 200, JSON.stringify(body));

  const { evaluation } = body;
  assert.equal(evaluation.uri, evaluationUris.a);
  assert.equal(evaluation.cid, 'bafyreihk4de5wsmo5a74dx7ut3zndgnreqtfvwwhetzqh3eun3xotsnek4');
  assert.equal(evaluation.indexedAt, '2025-03-04T05:06:07.000Z');
  assert.equal(evaluation.did, authorA);
  assert.equal(evaluation.record.$type, 'org.hypercerts.context.evaluation');
  assert.equal(evaluation.record.summary, 'Evaluation A');
  assert.equal(evaluation.record.score.value, '4.5');
  assert.deepEqual(evaluation.record.evaluators, [
    { did: evaluatorA },
    { did: evaluatorA },
    { did: 'did:web:context-evaluator-b.invalid' },
  ]);

  assert.equal(evaluation.author.did, authorA);
  assert.equal(evaluation.author.profile.record.displayName, 'Context evaluation publisher');
  assert.equal(evaluation.author.organization, null);
  assert.equal(evaluation.evaluators.length, 3);
  assert.equal(evaluation.evaluators[0].hydrationStatus, 'hydrated');
  assert.equal(evaluation.evaluators[0].profile.record.displayName, 'Named context evaluator');
  assert.equal(evaluation.evaluators[0].organization, null);
  assert.equal(evaluation.evaluators[1].did, evaluatorA);
  assert.equal(evaluation.evaluators[1].hydrationStatus, 'hydrated');
  assert.equal(evaluation.evaluators[2].hydrationStatus, 'hydrated');
  assert.equal(evaluation.evaluators[2].profile, null);
  assert.equal(evaluation.evaluators[2].organization, null);
});

test('getEvaluation preserves malformed raw evaluator entries and densely hydrates valid DID objects', async () => {
  const { response, body } = await request(getEndpoint, { uri: evaluationUris.e });
  assert.equal(response.status, 200, JSON.stringify(body));

  const { evaluation } = body;
  assert.deepEqual(evaluation.record.evaluators, [
    { did: evaluatorD }, legacyEvaluatorDid, { did: 'reviewer.example' }, { did: evaluatorD },
  ]);
  assert.deepEqual(evaluation.evaluators.map(({ did, hydrationStatus }) => ({ did, hydrationStatus })), [
    { did: evaluatorD, hydrationStatus: 'hydrated' },
    { did: evaluatorD, hydrationStatus: 'hydrated' },
  ]);
  assert.equal(evaluation.evaluators[0].profile.record.displayName, 'Tolerated projection evaluator');
  assert.equal(evaluation.evaluators[1].profile.record.displayName, 'Tolerated projection evaluator');
  assert.equal(evaluation.author.did, malformedAuthor);
});

test('getEvaluation exposes RecordNotFound and InvalidRequest through the pinned runtime error response', async () => {
  const missing = await request(getEndpoint, {
    uri: `at://${authorA}/org.hypercerts.context.evaluation/not-indexed`,
  });
  assert.equal(missing.response.status, 500, JSON.stringify(missing.body));
  assert.equal(missing.body.error, 'script_error');
  assert.equal(missing.body.errorType, 'runtime');
  assert.equal(missing.body.method, getEndpoint);
  assert.match(missing.body.message, /RecordNotFound/);

  const invalid = await request(getEndpoint, {
    uri: `at://${authorA}/org.hypercerts.claim.activity/not-an-evaluation`,
  });
  assert.equal(invalid.response.status, 500, JSON.stringify(invalid.body));
  assert.equal(invalid.body.error, 'script_error');
  assert.equal(invalid.body.errorType, 'runtime');
  assert.equal(invalid.body.method, getEndpoint);
  assert.match(invalid.body.message, /InvalidRequest/);
});

test('listEvaluations applies each filter, ORs repeated values, and ANDs distinct filters', async () => {
  const subjectB = 'at://did:web:context-eval-subject-b.invalid/org.hypercerts.claim.activity/subject-b';
  const otherAuthor = 'did:web:context-evaluation-b.invalid';
  const otherEvaluator = 'did:web:context-evaluator-b.invalid';

  for (const [params, expectedUris] of [
    [{ authors: [authorA] }, [evaluationUris.a, evaluationUris.b]],
    [{ authors: [authorA, otherAuthor] }, [evaluationUris.a, evaluationUris.b, evaluationUris.c, evaluationUris.d]],
    [{ evaluators: [evaluatorA] }, [evaluationUris.a]],
    [{ evaluators: [evaluatorA, otherEvaluator] }, [evaluationUris.a, evaluationUris.b, evaluationUris.c]],
    [{ subjects: [subjectB] }, [evaluationUris.b]],
    [{ authors: [authorA, otherAuthor], evaluators: [otherEvaluator], subjects: [subjectB] }, [evaluationUris.b]],
  ]) {
    const { response, body } = await request(listEndpoint, { ...params, sortDirection: 'asc' });
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body.evaluations.map(({ uri }) => uri), expectedUris);
  }
});

test('listEvaluations paginates the complete feed across tied createdAt timestamps', async () => {
  const expected = [evaluationUris.a, evaluationUris.b, evaluationUris.c, evaluationUris.d];
  const authors = [authorA, 'did:web:context-evaluation-b.invalid'];
  const first = await request(listEndpoint, { authors, sortDirection: 'asc', limit: 2 });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.evaluations.map(({ uri }) => uri), expected.slice(0, 2));
  assert.equal(typeof first.body.cursor, 'string');

  const second = await request(listEndpoint, {
    authors, sortDirection: 'asc', limit: 2, cursor: first.body.cursor,
  });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.evaluations.map(({ uri }) => uri), expected.slice(2));
  assert.equal(Object.hasOwn(second.body, 'cursor'), false);
});

test('listEvaluations retains malformed evaluator records and paginates without dropping them', async () => {
  const params = { authors: [malformedAuthor], sortDirection: 'asc', limit: 1 };
  const first = await request(listEndpoint, params);
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.evaluations.map(({ uri }) => uri), [evaluationUris.e]);
  assert.deepEqual(first.body.evaluations[0].record.evaluators, [
    { did: evaluatorD }, legacyEvaluatorDid, { did: 'reviewer.example' }, { did: evaluatorD },
  ]);
  assert.deepEqual(first.body.evaluations[0].evaluators.map(({ did, hydrationStatus }) => ({ did, hydrationStatus })), [
    { did: evaluatorD, hydrationStatus: 'hydrated' },
    { did: evaluatorD, hydrationStatus: 'hydrated' },
  ]);
  assert.equal(typeof first.body.cursor, 'string');

  const second = await request(listEndpoint, { ...params, cursor: first.body.cursor });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.evaluations.map(({ uri }) => uri), [evaluationUris.f]);
  assert.equal(second.body.evaluations[0].evaluators[0].did, 'did:web:context-evaluator-c.invalid');
  assert.equal(second.body.evaluations[0].evaluators[0].hydrationStatus, 'hydrated');
  assert.equal(Object.hasOwn(second.body, 'cursor'), false);
});

test('listEvaluations exposes InvalidRequest through the pinned runtime error response', async () => {
  const { response, body } = await request(listEndpoint, { limit: 101 });
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, listEndpoint);
  assert.match(body.message, /InvalidRequest/);
});
