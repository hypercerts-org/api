import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const contributorUri = 'at://did:web:contributor-http-author-a.invalid/org.hypercerts.claim.contributorInformation/3jzfcijpj2z2a';
const collection = 'org.hypercerts.claim.contributorInformation';

async function getContributorInformation(uri) {
  const url = contractUrl(requireContractTarget(), 'org.hypercerts.claim.getContributorInformation', { uri });
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

test('getContributorInformation fetches by AT-URI without supplying its pinned CID and hydrates publisher records', async () => {
  const { response, body } = await getContributorInformation(contributorUri);
  assert.equal(response.status, 200, JSON.stringify(body));

  const view = body.contributorInformation;
  assert.equal(view.uri, contributorUri);
  assert.equal(view.did, 'did:web:contributor-http-author-a.invalid');
  assert.equal(view.record.$type, collection);
  assert.equal(view.record.identifier, 'manual:cedar-restorer');
  assert.equal(view.record.displayName, 'Cedar Restorer');
  assert.equal(
    view.cid,
    'bafyreicjb36r5phxdx46gn5m75zk7csjqs6j47xnstvxoerdfy7jvkajxy',
    'the AT-URI lookup returns its known CBOR-derived CID without supplying that CID in the request',
  );
  assert.equal(view.author.did, 'did:web:contributor-http-author-a.invalid');
  assert.equal(view.author.profile.record.displayName, 'Cedar Watershed Group');
  assert.deepEqual(view.author.organization.record.organizationType, ['nonprofit']);
});

test('getContributorInformation returns null for absent publisher sidecars', async () => {
  const missingSidecarUri = 'at://did:web:contributor-http-author-b.invalid/org.hypercerts.claim.contributorInformation/3jzfcijpj2z2b';
  const { response, body } = await getContributorInformation(missingSidecarUri);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.contributorInformation.author.profile, null);
  assert.equal(body.contributorInformation.author.organization, null);
});

test('getContributorInformation exposes RecordNotFound as the pinned HappyView runtime error', async () => {
  const missingUri = 'at://did:web:contributor-http-author-a.invalid/org.hypercerts.claim.contributorInformation/3jzfcijpj2z2d';
  const { response, body } = await getContributorInformation(missingUri);
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, 'org.hypercerts.claim.getContributorInformation');
  assert.match(body.message, /RecordNotFound/);
});

test('getContributorInformation exposes InvalidRequest as the pinned HappyView runtime error', async () => {
  const malformedUri = 'at://did:plc:mm%GG/org.hypercerts.claim.contributorInformation/3jzfcijpj2z2a';
  const { response, body } = await getContributorInformation(malformedUri);
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, 'org.hypercerts.claim.getContributorInformation');
  assert.match(body.message, /InvalidRequest/);
});
