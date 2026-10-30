import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const endpoint = 'org.hypercerts.claim.getContribution';
const listEndpoint = 'org.hypercerts.claim.listContributions';
const publisherDid = 'did:web:contribution-a.invalid';
const secondPublisherDid = 'did:web:contribution-b.invalid';
const thirdPublisherDid = 'did:web:contribution-c.invalid';
const contributionUris = {
  alpha: `at://${publisherDid}/org.hypercerts.claim.contribution/alpha`,
  beta: `at://${publisherDid}/org.hypercerts.claim.contribution/beta`,
  gamma: `at://${secondPublisherDid}/org.hypercerts.claim.contribution/gamma`,
  delta: `at://${secondPublisherDid}/org.hypercerts.claim.contribution/delta`,
  epsilon: `at://${thirdPublisherDid}/org.hypercerts.claim.contribution/epsilon`,
};
const contributionUri = `at://${publisherDid}/org.hypercerts.claim.contribution/alpha`;

async function getContribution(uri) {
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

async function listContributions(params) {
  const url = contractUrl(requireContractTarget(), listEndpoint, params);
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

function assertRuntimeError({ response, body }, method, errorName) {
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error', JSON.stringify(body));
  assert.equal(body.errorType, 'runtime', JSON.stringify(body));
  assert.equal(body.method, method, JSON.stringify(body));
  assert.match(body.message, new RegExp(errorName), JSON.stringify(body));
}

test('getContribution returns the indexed record with hydrated and absent publisher sidecars', async () => {
  const { response, body } = await getContribution(contributionUri);
  assert.equal(response.status, 200, JSON.stringify(body));

  const { contribution } = body;
  assert.equal(contribution.uri, contributionUri);
  assert.equal(contribution.cid, 'bafyreif6gehuwhz66an7zqjzm5ujwiglugbuh76uk74wf6lohne6nfyyly');
  assert.equal(contribution.did, publisherDid);
  assert.equal(contribution.indexedAt, '2025-04-01T00:00:00.000Z');
  assert.deepEqual(contribution.record, {
    $type: 'org.hypercerts.claim.contribution',
    role: 'Survey lead',
    contributionDescription: 'Mapped riverbank vegetation.',
    createdAt: '2025-03-01T00:00:00Z',
  });
  assert.equal(contribution.author.did, publisherDid);
  assert.equal(contribution.author.profile.uri, `at://${publisherDid}/app.certified.actor.profile/self`);
  assert.equal(contribution.author.profile.record.displayName, 'River Survey Publisher');
  assert.equal(contribution.author.organization, null);
});

test('getContribution exposes named request and missing-record errors through the pinned runtime', async () => {
  const invalid = await getContribution('at://alice.example/org.hypercerts.claim.contribution/alpha');
  assertRuntimeError(invalid, endpoint, 'InvalidRequest');

  const missing = await getContribution(`at://${publisherDid}/org.hypercerts.claim.contribution/not-indexed`);
  assertRuntimeError(missing, endpoint, 'RecordNotFound');
});

test('listContributions paginates the complete feed with stable tied ordering in both directions', async () => {
  async function pagesInDirection(sortDirection) {
    const pages = [];
    let cursor;
    for (let page = 0; page < 3; page += 1) {
      const params = { sortDirection, limit: 2, ...(cursor ? { cursor } : {}) };
      const result = await listContributions(params);
      assert.equal(result.response.status, 200, JSON.stringify(result.body));
      pages.push(result.body);
      cursor = result.body.cursor;
      if (!cursor) break;
    }
    assert.equal(pages.length, 3);
    assert.equal(typeof pages[0].cursor, 'string');
    assert.equal(typeof pages[1].cursor, 'string');
    assert.equal(Object.hasOwn(pages[2], 'cursor'), false);
    return pages;
  }

  const ascending = await pagesInDirection('asc');
  assert.deepEqual(ascending.map(({ contributions }) => contributions.map(({ uri }) => uri)), [
    [contributionUris.epsilon, contributionUris.delta],
    [contributionUris.alpha, contributionUris.beta],
    [contributionUris.gamma],
  ]);
  assert.equal(ascending[1].contributions[0].author.profile.record.displayName, 'River Survey Publisher');
  assert.equal(ascending[1].contributions[0].author.organization, null);

  const descending = await pagesInDirection('desc');
  assert.deepEqual(descending.map(({ contributions }) => contributions.map(({ uri }) => uri)), [
    [contributionUris.gamma, contributionUris.beta],
    [contributionUris.alpha, contributionUris.delta],
    [contributionUris.epsilon],
  ]);
  assert.equal(descending[0].contributions[0].author.profile, null);
  assert.equal(descending[0].contributions[0].author.organization, null);
});

test('listContributions applies repeated publisher filters and returns no rows for a nonmatching author', async () => {
  const matching = await listContributions({
    authors: [publisherDid, secondPublisherDid],
    sortDirection: 'asc',
    limit: 10,
  });
  assert.equal(matching.response.status, 200, JSON.stringify(matching.body));
  assert.deepEqual(matching.body.contributions.map(({ uri }) => uri), [
    contributionUris.delta,
    contributionUris.alpha,
    contributionUris.beta,
    contributionUris.gamma,
  ]);

  const missing = await listContributions({
    authors: ['did:plc:rrrrrrrrrrrrrrrrrrrrrrrr'],
    sortDirection: 'asc',
  });
  assert.equal(missing.response.status, 200, JSON.stringify(missing.body));
  assert.deepEqual(missing.body.contributions, []);
  assert.equal(Object.hasOwn(missing.body, 'cursor'), false);
});

test('listContributions exposes InvalidRequest through the pinned runtime error response', async () => {
  const invalid = await listContributions({ limit: 101 });
  assertRuntimeError(invalid, listEndpoint, 'InvalidRequest');
});
