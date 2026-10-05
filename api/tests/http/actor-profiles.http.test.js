import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';
import { actorFixtureDids } from './fixtures/actors.fixture.js';

const endpoint = 'app.certified.actor.getProfile';
const profileCollection = 'app.certified.actor.profile';

async function requestActorEndpoint(nsid, params = {}) {
  const url = contractUrl(requireContractTarget(), nsid, params);
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

test('getProfile returns a seeded indexed profile with its independently checked CID', async () => {
  const actor = actorFixtureDids.alpine;
  const { response, body } = await requestActorEndpoint(endpoint, { actor });
  assert.equal(response.status, 200, JSON.stringify(body));

  assert.deepEqual(body.profile, {
    uri: `at://${actor}/${profileCollection}/self`,
    cid: 'bafyreihdq5dbdpgo2jabwd6ccqu7kr4jucot7vtfltcyjiqjponddvqfzm',
    indexedAt: '2025-03-03T04:05:06.000Z',
    did: actor,
    record: {
      $type: profileCollection,
      displayName: 'Alpine Forest Consortium',
      description: 'Forest restoration and mountain ecosystem monitoring.',
      createdAt: '2025-02-01T00:00:00.000Z',
    },
  });
});

test('getProfile reports a missing indexed profile using the pinned runtime error response', async () => {
  const { response, body } = await requestActorEndpoint(endpoint, {
    actor: 'did:plc:rrrrrrrrrrrrrrrrrrrrrrrr',
  });
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, endpoint);
  assert.match(body.message, /RecordNotFound/);
});

test('getProfiles preserves repeated actor occurrences and returns null for a missing profile', async () => {
  const absentActor = 'did:plc:rrrrrrrrrrrrrrrrrrrrrrrr';
  const requested = [actorFixtureDids.forest, absentActor, actorFixtureDids.alpine, actorFixtureDids.forest];
  const { response, body } = await requestActorEndpoint('app.certified.actor.getProfiles', { actors: requested });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.profiles.map(({ actor }) => actor), requested);
  assert.deepEqual(body.profiles.map(({ profile }) => profile?.record.displayName ?? null), [
    'Forest %_ Commons', null, 'Alpine Forest Consortium', 'Forest %_ Commons',
  ]);
  assert.deepEqual(body.profiles[1], { actor: absentActor, profile: null });
  assert.equal(Object.hasOwn(body, 'cursor'), false);
});

test('listProfiles paginates tied createdAt keys in both directions without repeating or omitting actor profiles', async () => {
  const expectedUrisByDirection = {
    asc: [
      `at://${actorFixtureDids.alpine}/${profileCollection}/self`,
      `at://${actorFixtureDids.forest}/${profileCollection}/self`,
      `at://${actorFixtureDids.river}/${profileCollection}/self`,
      `at://${actorFixtureDids.profileOnly}/${profileCollection}/self`,
    ],
    desc: [
      `at://${actorFixtureDids.profileOnly}/${profileCollection}/self`,
      `at://${actorFixtureDids.river}/${profileCollection}/self`,
      `at://${actorFixtureDids.forest}/${profileCollection}/self`,
      `at://${actorFixtureDids.alpine}/${profileCollection}/self`,
    ],
  };

  for (const direction of ['asc', 'desc']) {
    const expectedUris = expectedUrisByDirection[direction];
    const expectedUriSet = new Set(expectedUris);
    const actorUris = [];
    let cursor;
    let actorPages = 0;

    for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
      const params = { sortDirection: direction, limit: 2, ...(cursor ? { cursor } : {}) };
      const { response, body } = await requestActorEndpoint('app.certified.actor.listProfiles', params);
      assert.equal(response.status, 200, JSON.stringify(body));
      const pageActorProfiles = body.profiles.filter(({ uri }) => expectedUriSet.has(uri));
      if (pageActorProfiles.length > 0) actorPages += 1;
      assert.ok(pageActorProfiles.every(({ record }) => record.createdAt === '2025-02-01T00:00:00.000Z'));
      actorUris.push(...pageActorProfiles.map(({ uri }) => uri));
      cursor = body.cursor;
      if (!cursor) break;
      assert.ok(pageNumber < 49, 'profile pagination did not terminate');
    }

    assert.deepEqual(actorUris, expectedUris);
    assert.equal(new Set(actorUris).size, expectedUris.length);
    assert.ok(actorPages > 1, `${direction} tied actor profiles must cross a page boundary`);
  }
});

test('searchProfiles combines literal text with the actor filter', async () => {
  const broad = await requestActorEndpoint('app.certified.actor.searchProfiles', {
    search: '  FOREST  ',
    actors: [actorFixtureDids.forest, actorFixtureDids.river],
    sortDirection: 'asc',
  });
  assert.equal(broad.response.status, 200, JSON.stringify(broad.body));
  assert.deepEqual(broad.body.profiles.map(({ did }) => did), [actorFixtureDids.forest, actorFixtureDids.river]);

  const literal = await requestActorEndpoint('app.certified.actor.searchProfiles', {
    search: '  %_  ',
    actors: [actorFixtureDids.river, actorFixtureDids.forest],
  });
  assert.equal(literal.response.status, 200, JSON.stringify(literal.body));
  assert.deepEqual(literal.body.profiles.map(({ did }) => did), [actorFixtureDids.forest]);
  assert.equal(literal.body.profiles[0].record.displayName, 'Forest %_ Commons');
});
