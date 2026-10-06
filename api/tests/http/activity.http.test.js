import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityContributorProfile,
  activityRecord,
  activityAuthorProfile,
  organizationOnlyActivityRecord,
  profilelessActivityRecord,
  staleOnlyActivityRecord,
} from '../fixtures/activities.js';
import { contractUrl, requireContractTarget } from './helpers.js';

const baseUrl = requireContractTarget();
const authorDid = activityRecord.did;
const contributorDid = activityContributorProfile.did;

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

test('getActivity preserves its source record and hydrates contributor versions and actors faithfully', async () => {
  const result = await get('org.hypercerts.claim.getActivity', { uri: activityRecord.uri });
  assert.deepEqual(result.activity.record, activityRecord.record);
  assert.deepEqual(result.activity.author, {
    did: authorDid,
    profile: recordView(activityAuthorProfile),
    organization: null,
  });

  const contributors = result.activity.contributors;
  assert.equal(contributors.length, activityRecord.record.contributors.length);
  assert.deepEqual(contributors.map(({ contributionWeight }) => contributionWeight), ['first', 'second', 'inline', 'external']);
  for (const stale of contributors.slice(0, 2)) {
    assert.equal(stale.contributorInformation, null);
    assert.equal(stale.actor, null, 'the newer CID at the same URI must not supply an identity');
  }
  assert.equal(contributors[2].contributorInformation, null);
  assert.deepEqual(contributors[2].actor, {
    did: contributorDid,
    profile: recordView(activityContributorProfile),
  });
  assert.equal(contributors[3].contributorInformation, null);
  assert.equal(contributors[3].actor, null);
});

test('listActivities filters by contributor DID only when the exact referenced version is available', async () => {
  const result = await get('org.hypercerts.claim.listActivities', {
    authors: [authorDid],
    hasOrganizationRecord: false,
    contributors: [contributorDid],
    involvedActors: [contributorDid],
    uris: [activityRecord.uri, staleOnlyActivityRecord.uri],
    sortDirection: 'asc',
    limit: 100,
  });
  assert.deepEqual(result.activities.map(({ uri }) => uri), [activityRecord.uri]);

  const staleOnly = await get('org.hypercerts.claim.listActivities', {
    contributors: [contributorDid], uris: [staleOnlyActivityRecord.uri],
  });
  assert.deepEqual(staleOnly.activities, []);
});

test('listActivities filters by organization self-record presence independently of profiles', async () => {
  const organizationAuthor = await get('org.hypercerts.claim.listActivities', {
    authors: [organizationOnlyActivityRecord.did], hasOrganizationRecord: true,
  });
  assert.deepEqual(organizationAuthor.activities.map(({ uri }) => uri), [organizationOnlyActivityRecord.uri]);
  assert.equal(organizationAuthor.activities[0].author.profile, null);
  assert.equal(organizationAuthor.activities[0].author.organization.did, organizationOnlyActivityRecord.did);
  assert.equal(organizationAuthor.activities[0].author.organization.record.organizationType[0], 'community');

  const organizationExcluded = await get('org.hypercerts.claim.listActivities', {
    authors: [organizationOnlyActivityRecord.did], hasOrganizationRecord: false,
  });
  assert.deepEqual(organizationExcluded.activities, []);

  const profilelessAuthor = await get('org.hypercerts.claim.listActivities', {
    authors: [profilelessActivityRecord.did], hasOrganizationRecord: false,
  });
  assert.deepEqual(profilelessAuthor.activities.map(({ uri }) => uri), [profilelessActivityRecord.uri]);
  assert.equal(profilelessAuthor.activities[0].author.profile, null);
  assert.equal(profilelessAuthor.activities[0].author.organization, null);

  const profilelessExcluded = await get('org.hypercerts.claim.listActivities', {
    authors: [profilelessActivityRecord.did], hasOrganizationRecord: true,
  });
  assert.deepEqual(profilelessExcluded.activities, []);
});

test('searchActivities treats wildcard characters literally and applies URI filters', async () => {
  const result = await get('org.hypercerts.claim.searchActivities', {
    search: '  pinned %_ activity  ',
    uris: [activityRecord.uri, staleOnlyActivityRecord.uri],
  });
  assert.deepEqual(result.activities.map(({ uri }) => uri), [activityRecord.uri]);
  assert.deepEqual(result.activities[0].author.profile, recordView(activityAuthorProfile));
});

test('getActivity distinguishes an unindexed URI from a successful empty listing', async () => {
  const missing = await fetch(contractUrl(baseUrl, 'org.hypercerts.claim.getActivity', {
    uri: `at://${authorDid}/org.hypercerts.claim.activity/missing`,
  }));
  await assertDomainError(missing, 'RecordNotFound');

  const empty = await get('org.hypercerts.claim.listActivities', {
    uris: [`at://${authorDid}/org.hypercerts.claim.activity/missing`],
  });
  assert.deepEqual(empty.activities, []);
  assert.equal(empty.cursor, undefined);
});

const httpActivityAuthorDid = 'did:web:activity-http-author.invalid';
const httpActivityUri = (rkey) => `at://${httpActivityAuthorDid}/org.hypercerts.claim.activity/${rkey}`;
const httpActivityUris = ['3jzfcijpj2z2a', '3jzfcijpj2z2b', '3jzfcijpj2z2c', '3jzfcijpj2z2d', '3jzfcijpj2z2e', '3jzfcijpj2z2f'].map(httpActivityUri);
const httpIndexedAt = '2025-01-02T03:04:05.000Z';

async function requestActivityEndpoint(nsid, params) {
  const response = await fetch(contractUrl(baseUrl, nsid, params), {
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

test('getActivity returns the CBOR-addressed fixture and hydrated nullable sidecars over HTTP', async () => {
  const { response, body } = await requestActivityEndpoint('org.hypercerts.claim.getActivity', {
    uri: httpActivityUris[0],
  });
  assert.equal(response.status, 200, JSON.stringify(body));

  const { activity } = body;
  assert.equal(activity.uri, httpActivityUris[0]);
  assert.equal(activity.cid, 'bafyreifwuqjh4n2ithuqzwce4unihjybfzgjnqidagk5zba6u2syhirbdq');
  assert.equal(activity.indexedAt, httpIndexedAt);
  assert.equal(activity.did, httpActivityAuthorDid);
  assert.deepEqual(activity.record, {
    $type: 'org.hypercerts.claim.activity',
    title: 'River restoration %_ fixture',
    shortDescription: 'A literal search phrase for the activity HTTP endpoint.',
    createdAt: '2025-02-01T00:00:00Z',
    contributors: [
      { contributorIdentity: { $type: 'org.hypercerts.claim.activity#contributorIdentity', identity: 'did:web:activity-http-contributor.invalid' }, contributionWeight: '1' },
      { contributorIdentity: { $type: 'org.hypercerts.claim.activity#contributorIdentity', identity: 'did:web:activity-http-profileless-contributor.invalid' }, contributionWeight: '2' },
      { contributorIdentity: { $type: 'org.hypercerts.claim.activity#contributorIdentity', identity: 'https://example.org/external-contributor' }, contributionWeight: '3' },
    ],
  });
  assert.equal(activity.author.did, httpActivityAuthorDid);
  assert.equal(activity.author.profile.record.displayName, 'Activity HTTP author');
  assert.deepEqual(activity.author.organization.record.organizationType, ['nonprofit']);
  assert.deepEqual(activity.author.organization.record.visibility, 'public');

  assert.equal(activity.contributors.length, 3);
  assert.equal(activity.contributors[0].actor.did, 'did:web:activity-http-contributor.invalid');
  assert.equal(activity.contributors[0].actor.profile.record.displayName, 'Activity HTTP contributor');
  assert.equal(activity.contributors[1].actor.did, 'did:web:activity-http-profileless-contributor.invalid');
  assert.equal(activity.contributors[1].actor.profile, null);
  assert.equal(activity.contributors[2].actor, null);
  assert.deepEqual(activity.contributors.map(({ contributorInformation }) => contributorInformation), [null, null, null]);
});

test('listActivities paginates tied createdAt values by URI without repeats or omissions over HTTP', async () => {
  const first = await requestActivityEndpoint('org.hypercerts.claim.listActivities', {
    authors: [httpActivityAuthorDid],
    hasOrganizationRecord: true,
    sortDirection: 'asc',
    limit: 2,
  });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.activities.map(({ uri }) => uri), httpActivityUris.slice(0, 2));
  assert.equal(typeof first.body.cursor, 'string');

  const second = await requestActivityEndpoint('org.hypercerts.claim.listActivities', {
    authors: [httpActivityAuthorDid],
    hasOrganizationRecord: true,
    sortDirection: 'asc',
    limit: 2,
    cursor: first.body.cursor,
  });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.activities.map(({ uri }) => uri), httpActivityUris.slice(2, 4));
  assert.equal(typeof second.body.cursor, 'string');

  const third = await requestActivityEndpoint('org.hypercerts.claim.listActivities', {
    authors: [httpActivityAuthorDid],
    hasOrganizationRecord: true,
    sortDirection: 'asc',
    limit: 2,
    cursor: second.body.cursor,
  });
  assert.equal(third.response.status, 200, JSON.stringify(third.body));
  assert.deepEqual(third.body.activities.map(({ uri }) => uri), httpActivityUris.slice(4));
  assert.equal(Object.hasOwn(third.body, 'cursor'), false);
});

test('searchActivities trims case, matches percent and underscore literally, and filters authors over HTTP', async () => {
  const wildcardOnlyUri = httpActivityUris[5];
  const otherAuthorLiteralUri = 'at://did:web:activity-http-other-author.invalid/org.hypercerts.claim.activity/3jzfcijpj2z2a';
  for (const [uri, title] of [
    [wildcardOnlyUri, 'River restoration by communities'],
    [otherAuthorLiteralUri, 'River restoration %_ from another author'],
  ]) {
    const control = await requestActivityEndpoint('org.hypercerts.claim.getActivity', { uri });
    assert.equal(control.response.status, 200, JSON.stringify(control.body));
    assert.equal(control.body.activity.uri, uri);
    assert.equal(control.body.activity.record.title, title);
  }

  const { response, body } = await requestActivityEndpoint('org.hypercerts.claim.searchActivities', {
    search: '  RIVER restoration %_  ',
    authors: [httpActivityAuthorDid],
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.activities.map(({ uri }) => uri), [httpActivityUris[0]]);
  assert.equal(body.activities[0].record.title, 'River restoration %_ fixture');
  assert.equal(body.activities[0].author.organization.did, httpActivityAuthorDid);
});
