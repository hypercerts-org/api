import test from 'node:test';
import assert from 'node:assert/strict';
import { actorFixtureDids, seedRows } from './fixtures/actors.fixture.js';
import { contractUrl, requireContractTarget } from './helpers.js';

const baseUrl = requireContractTarget();
const organizationCollection = 'app.certified.actor.organization';
const profileCollection = 'app.certified.actor.profile';
const organizationRecords = seedRows.filter(({ collection }) => collection === organizationCollection);
const profileRecords = seedRows.filter(({ collection }) => collection === profileCollection);
const publicOrganization = organizationRecords.find(({ did }) => did === actorFixtureDids.alpine);
const profilelessOrganization = organizationRecords.find(({ did }) => did === actorFixtureDids.organizationOnly);
const unlistedOrganization = organizationRecords.find(({ did }) => did === actorFixtureDids.forest);
const unlistedProfile = profileRecords.find(({ did }) => did === unlistedOrganization.did);

function recordView(record) {
  return {
    uri: record.uri,
    cid: record.cid,
    indexedAt: record.indexedAt,
    did: record.did,
    record: record.record,
  };
}

async function get(nsid, params) {
  const response = await fetch(contractUrl(baseUrl, nsid, params));
  const body = await response.json();
  assert.equal(response.status, 200, `${nsid}: ${JSON.stringify(body)}`);
  return body;
}

async function assertDomainError(response, code) {
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.match(body.message, new RegExp(`^runtime error: ${code}:`));
  assert.doesNotMatch(body.message, /SELECT|happyview_records|at:\/\//);
}

test('getOrganization returns the original sidecar and explicit nullable profile', async () => {
  const withProfile = await get('app.certified.actor.getOrganization', { actor: publicOrganization.did });
  assert.deepEqual(withProfile.actor, {
    did: publicOrganization.did,
    profile: recordView(profileRecords[0]),
    organization: recordView(publicOrganization),
  });

  const withoutProfile = await get('app.certified.actor.getOrganization', { actor: profilelessOrganization.did });
  assert.deepEqual(withoutProfile.actor, {
    did: profilelessOrganization.did,
    profile: null,
    organization: recordView(profilelessOrganization),
  });
});

test('getOrganization reports missing sidecars and listOrganizations rejects unsupported filters', async () => {
  const missing = await fetch(contractUrl(baseUrl, 'app.certified.actor.getOrganization', {
    actor: 'did:web:organization-not-seeded.example',
  }));
  await assertDomainError(missing, 'RecordNotFound');

  const unsupportedActorsFilter = await fetch(contractUrl(baseUrl, 'app.certified.actor.listOrganizations', {
    actors: [publicOrganization.did],
  }));
  await assertDomainError(unsupportedActorsFilter, 'InvalidRequest');

  const unaccepted = await fetch(contractUrl(baseUrl, 'app.certified.actor.listOrganizations', {
    foundedAfter: '2020-01-01T00:00:00Z',
  }));
  await assertDomainError(unaccepted, 'InvalidRequest');
});

test('getOrganizations preserves repeated DID occurrences and serializes a missing sidecar as null', async () => {
  const missingDid = 'did:web:organization-not-seeded.example';
  const requested = [profilelessOrganization.did, missingDid, publicOrganization.did, profilelessOrganization.did];
  const result = await get('app.certified.actor.getOrganizations', { actors: requested });
  assert.deepEqual(result.organizations.map(({ actor }) => actor), requested);
  assert.deepEqual(
    result.organizations.map(({ organization }) => organization === null ? null : organization.did),
    [profilelessOrganization.did, null, publicOrganization.did, profilelessOrganization.did],
  );
  assert.deepEqual(result.organizations[0].organization, {
    did: profilelessOrganization.did,
    profile: null,
    organization: recordView(profilelessOrganization),
  });
  assert.deepEqual(result.organizations[0], result.organizations[3]);
  assert.deepEqual(result.organizations[2].organization.profile, recordView(profileRecords[0]));
  assert.equal(Object.hasOwn(result, 'cursor'), false);
});

test('listOrganizations combines exact type and visibility filters and leaves omitted visibility unrestricted', async () => {
  const organizations = await get('app.certified.actor.listOrganizations', { limit: 100 });
  const listedUris = new Set(organizations.actors.map(({ organization }) => organization.uri));
  for (const organization of organizationRecords) assert.ok(listedUris.has(organization.uri));
  const byDid = new Map(organizations.actors.map((actor) => [actor.did, actor]));
  assert.equal(byDid.get(publicOrganization.did).organization.record.visibility, 'public');
  assert.equal(byDid.get(profilelessOrganization.did).organization.record.visibility, undefined);
  assert.equal(byDid.get(profilelessOrganization.did).profile, null);
  assert.equal(byDid.get(unlistedOrganization.did).organization.record.visibility, 'unlisted');
  assert.equal(byDid.get(unlistedOrganization.did).profile.record.displayName, unlistedProfile.record.displayName);

  const communityOrCooperative = await get('app.certified.actor.listOrganizations', {
    organizationTypes: ['community', 'cooperative'], sortDirection: 'asc', limit: 100,
  });
  assert.deepEqual(communityOrCooperative.actors.map(({ did }) => did), [
    'did:plc:cccccccccccccccccccccccc',
    'did:web:organization-only.example',
    'did:plc:mmmmmmmmmmmmmmmmmmmmmmmm',
    'did:plc:nnnnnnnnnnnnnnnnnnnnnnnn',
    'did:plc:qqqqqqqqqqqqqqqqqqqqqqqq',
    'did:plc:jjjjjjjjjjjjjjjjjjjjjjjj',
  ]);

  const communityUnlisted = await get('app.certified.actor.listOrganizations', {
    organizationTypes: ['community'], visibility: 'unlisted', limit: 100,
  });
  assert.deepEqual(communityUnlisted.actors.map(({ did }) => did), [actorFixtureDids.forest]);
  assert.deepEqual(communityUnlisted.actors[0].organization.record.organizationType, ['community']);
  assert.equal(communityUnlisted.actors[0].organization.record.visibility, 'unlisted');

  const publicOnly = await get('app.certified.actor.listOrganizations', { visibility: 'public' });
  assert.ok(publicOnly.actors.some(({ organization }) => organization.uri === publicOrganization.uri));
  assert.ok(publicOnly.actors.every(({ organization }) => organization.record.visibility === 'public'));
  const unlistedOnly = await get('app.certified.actor.listOrganizations', { visibility: 'unlisted' });
  assert.ok(unlistedOnly.actors.some(({ organization }) => organization.uri === unlistedOrganization.uri));
  assert.ok(unlistedOnly.actors.every(({ organization }) => organization.record.visibility === 'unlisted'));
});

test('searchOrganizations matches full trimmed literal profile text and excludes organizations without profiles', async () => {
  const result = await get('app.certified.actor.searchOrganizations', {
    search: '  Forest %_ Commons  ', actors: [unlistedOrganization.did],
  });
  assert.equal(result.actors.length, 1);
  assert.equal(result.actors[0].did, unlistedOrganization.did);
  assert.equal(result.actors[0].profile.record.displayName, 'Forest %_ Commons');
  assert.deepEqual(result.actors[0].organization.record, unlistedOrganization.record);

  const absentProfile = await get('app.certified.actor.searchOrganizations', {
    search: 'community', actors: [profilelessOrganization.did],
  });
  assert.deepEqual(absentProfile.actors, []);
});

test('listOrganizations paginates stably in both directions without skipping equal-timestamp records', async () => {
  const itemsByDirection = {};
  for (const direction of ['asc', 'desc']) {
    const items = [];
    let cursor;
    do {
      const page = await get('app.certified.actor.listOrganizations', {
        sortDirection: direction, limit: 1, cursor,
      });
      assert.equal(page.actors.length, 1);
      items.push(page.actors[0].organization.uri);
      cursor = page.cursor;
    } while (cursor);

    assert.equal(new Set(items).size, items.length);
    for (const organization of organizationRecords) assert.ok(items.includes(organization.uri));
    itemsByDirection[direction] = items;
  }
  assert.deepEqual(itemsByDirection.asc, [...itemsByDirection.desc].reverse());
});
