import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const endpoint = 'org.hypercerts.claim.listContributorInformation';
const authorA = 'did:plc:mmmmmmmmmmmmmmmmmmmmmmmm';
const authorB = 'did:plc:nnnnnnnnnnnnnnnnnnnnnnnn';
const authorC = 'did:plc:oooooooooooooooooooooooo';
const uris = {
  baseline: 'at://did:plc:gggggggggggggggggggggggg/org.hypercerts.claim.contributorInformation/3jzfcijpj2z2h',
  a: `at://${authorA}/org.hypercerts.claim.contributorInformation/3jzfcijpj2z2a`,
  b: `at://${authorB}/org.hypercerts.claim.contributorInformation/3jzfcijpj2z2b`,
  c: `at://${authorC}/org.hypercerts.claim.contributorInformation/3jzfcijpj2z2c`,
};

async function listContributorInformation(params = {}) {
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

test('listContributorInformation applies repeated author filters and excludes other publishers', async () => {
  const { response, body } = await listContributorInformation({
    authors: [authorA, authorC],
    sortDirection: 'asc',
    limit: 10,
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.contributorInformation.map(({ uri }) => uri), [uris.a, uris.c]);
  assert.equal(body.contributorInformation[0].author.profile.record.displayName, 'Cedar Watershed Group');
  assert.deepEqual(body.contributorInformation[0].author.organization.record.organizationType, ['nonprofit']);
  assert.equal(body.contributorInformation[1].author.profile, null);
  assert.equal(body.contributorInformation[1].author.organization, null);
  assert.equal(Object.hasOwn(body, 'cursor'), false);
});

test('listContributorInformation paginates tied createdAt values in both directions and retains baseline rows', async () => {
  for (const { direction, firstUris, secondUris, allUris } of [
    {
      direction: 'asc',
      firstUris: [uris.baseline, uris.a],
      secondUris: [uris.b, uris.c],
      allUris: [uris.baseline, uris.a, uris.b, uris.c],
    },
    {
      direction: 'desc',
      firstUris: [uris.c, uris.b],
      secondUris: [uris.a, uris.baseline],
      allUris: [uris.c, uris.b, uris.a, uris.baseline],
    },
  ]) {
    const first = await listContributorInformation({ sortDirection: direction, limit: 2 });
    assert.equal(first.response.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.contributorInformation.map(({ uri }) => uri), firstUris);
    assert.equal(typeof first.body.cursor, 'string');
    assert.ok(first.body.cursor.length > 0);

    const second = await listContributorInformation({ sortDirection: direction, limit: 2, cursor: first.body.cursor });
    assert.equal(second.response.status, 200, JSON.stringify(second.body));
    assert.deepEqual(second.body.contributorInformation.map(({ uri }) => uri), secondUris);
    assert.equal(Object.hasOwn(second.body, 'cursor'), false);
    assert.deepEqual(
      [...first.body.contributorInformation, ...second.body.contributorInformation].map(({ uri }) => uri),
      allUris,
    );

    const allRows = [...first.body.contributorInformation, ...second.body.contributorInformation];
    const missingSidecar = allRows.find(({ uri }) => uri === uris.b);
    assert.ok(missingSidecar);
    assert.equal(missingSidecar.author.profile, null);
    assert.equal(missingSidecar.author.organization, null);
    const baseline = allRows.find(({ uri }) => uri === uris.baseline);
    assert.equal(baseline.author.profile.record.displayName, 'Activity fixture author');
  }
});

test('listContributorInformation exposes InvalidRequest as the pinned HappyView runtime error', async () => {
  const { response, body } = await listContributorInformation({ limit: 101 });
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, endpoint);
  assert.match(body.message, /InvalidRequest/);
});
