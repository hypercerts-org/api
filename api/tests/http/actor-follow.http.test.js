import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';
import { graphDids, seedRows } from './fixtures/graph-follows.fixture.js';

const baseUrl = requireContractTarget();
const followCollection = 'app.certified.graph.follow';

async function request(nsid, params) {
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

function fixtureRow(uri) {
  const row = seedRows.find((candidate) => candidate.uri === uri);
  assert.ok(row, `missing graph fixture row ${uri}`);
  return row;
}

function recordView(row) {
  return {
    uri: row.uri,
    cid: row.cid,
    indexedAt: row.indexedAt,
    did: row.did,
    record: row.record,
  };
}

function actorView(did, followUri) {
  const sidecar = (collection) => seedRows.find((row) => row.did === did && row.collection === collection);
  const profile = sidecar('app.certified.actor.profile');
  const organization = sidecar('app.certified.actor.organization');
  return {
    did,
    profile: profile ? recordView(profile) : null,
    organization: organization ? recordView(organization) : null,
    follow: recordView(fixtureRow(followUri)),
  };
}

async function collectPages(nsid, outputKey, actor, expected) {
  const pages = [];
  let cursor;
  for (const expectation of expected) {
    const { response, body } = await request(nsid, {
      actor,
      limit: 1,
      sortDirection: 'asc',
      cursor,
    });
    assert.equal(response.status, 200, `${nsid}: ${JSON.stringify(body)}`);
    assert.equal(body.totalCount, expected.length);
    assert.equal(body[outputKey].length, 1);
    const [item] = body[outputKey];
    assert.equal(item.did, expectation.did);
    assert.equal(item.follow.uri, expectation.uri);
    assert.equal(item.follow.did, expectation.publisher);
    assert.equal(item.follow.record.$type, followCollection);
    pages.push(item);
    cursor = body.cursor;
    if (expectation.hasNext) assert.equal(typeof cursor, 'string');
    else assert.equal(Object.hasOwn(body, 'cursor'), false);
  }
  return pages;
}

test('listActorFollowers ranks the earliest duplicate before asc pagination and hydrates nullable sidecars', async () => {
  const pages = await collectPages(
    'app.certified.graph.listActorFollowers',
    'followers',
    graphDids.primarySubject,
    [
      {
        did: graphDids.secondPublisher,
        publisher: graphDids.secondPublisher,
        uri: `at://${graphDids.secondPublisher}/${followCollection}/3jzfcijpj2z2f`,
        hasNext: true,
      },
      {
        did: graphDids.thirdFollower,
        publisher: graphDids.thirdFollower,
        uri: `at://${graphDids.thirdFollower}/${followCollection}/3jzfcijpj2z2g`,
        hasNext: true,
      },
      {
        did: graphDids.publisher,
        publisher: graphDids.publisher,
        uri: `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2a`,
        hasNext: false,
      },
    ],
  );

  assert.deepEqual(pages, [
    actorView(graphDids.secondPublisher, `at://${graphDids.secondPublisher}/${followCollection}/3jzfcijpj2z2f`),
    actorView(graphDids.thirdFollower, `at://${graphDids.thirdFollower}/${followCollection}/3jzfcijpj2z2g`),
    actorView(graphDids.publisher, `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2a`),
  ]);
  assert.equal(pages[0].profile, null);
  assert.equal(pages[0].organization, null);
  assert.equal(pages[1].profile, null);
  assert.equal(pages[1].organization, null);
  assert.equal(pages[2].profile.record.displayName, 'Graph Fixture Publisher');
  assert.deepEqual(pages[2].organization.record.organizationType, ['nonprofit']);
});

test('listActorFollowing filters by publisher and keyset-pages tied relationships without losing subject identity', async () => {
  const pages = await collectPages(
    'app.certified.graph.listActorFollowing',
    'following',
    graphDids.publisher,
    [
      {
        did: graphDids.primarySubject,
        publisher: graphDids.publisher,
        uri: `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2a`,
        hasNext: true,
      },
      {
        did: graphDids.secondSubject,
        publisher: graphDids.publisher,
        uri: `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2c`,
        hasNext: true,
      },
      {
        did: graphDids.thirdSubject,
        publisher: graphDids.publisher,
        uri: `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2d`,
        hasNext: false,
      },
    ],
  );

  assert.deepEqual(pages, [
    actorView(graphDids.primarySubject, `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2a`),
    actorView(graphDids.secondSubject, `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2c`),
    actorView(graphDids.thirdSubject, `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2d`),
  ]);
  assert.equal(pages[0].profile.record.displayName, 'Primary Graph Subject');
  assert.deepEqual(pages[0].organization.record.organizationType, ['cooperative']);
  assert.equal(pages[1].profile.record.displayName, 'Second Graph Subject');
  assert.equal(pages[1].organization, null);
  assert.equal(pages[2].profile, null);
  assert.equal(pages[2].organization, null);
  assert.equal(pages[0].follow.record.via.uri, `at://${graphDids.curator}/app.certified.graph.list/3jzfcijpj2z2a`);
});

test('actor follower and following lists apply descending URI tie-breaks through cursors', async () => {
  const cases = [
    {
      nsid: 'app.certified.graph.listActorFollowers',
      outputKey: 'followers',
      actor: graphDids.primarySubject,
      expectedUris: [
        `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2a`,
        `at://${graphDids.thirdFollower}/${followCollection}/3jzfcijpj2z2g`,
        `at://${graphDids.secondPublisher}/${followCollection}/3jzfcijpj2z2f`,
      ],
      expectedDids: [graphDids.publisher, graphDids.thirdFollower, graphDids.secondPublisher],
    },
    {
      nsid: 'app.certified.graph.listActorFollowing',
      outputKey: 'following',
      actor: graphDids.publisher,
      expectedUris: [
        `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2d`,
        `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2c`,
        `at://${graphDids.publisher}/${followCollection}/3jzfcijpj2z2a`,
      ],
      expectedDids: [graphDids.thirdSubject, graphDids.secondSubject, graphDids.primarySubject],
    },
  ];

  for (const { nsid, outputKey, actor, expectedUris, expectedDids } of cases) {
    let cursor;
    const actualUris = [];
    const actualDids = [];
    for (let index = 0; index < expectedUris.length; index += 1) {
      const { response, body } = await request(nsid, {
        actor,
        limit: 1,
        sortDirection: 'desc',
        cursor,
      });
      assert.equal(response.status, 200, `${nsid}: ${JSON.stringify(body)}`);
      assert.equal(body.totalCount, expectedUris.length);
      assert.equal(body[outputKey].length, 1);
      actualUris.push(body[outputKey][0].follow.uri);
      actualDids.push(body[outputKey][0].did);
      cursor = body.cursor;
      if (index < expectedUris.length - 1) assert.equal(typeof cursor, 'string');
      else assert.equal(Object.hasOwn(body, 'cursor'), false);
    }
    assert.deepEqual(actualUris, expectedUris);
    assert.deepEqual(actualDids, expectedDids);
  }
});

test('actor list input failures use the pinned HappyView runtime error response', async () => {
  const cases = [
    {
      nsid: 'app.certified.graph.listActorFollowers',
      params: { actor: graphDids.primarySubject, limit: 101 },
    },
    {
      nsid: 'app.certified.graph.listActorFollowing',
      params: { actor: graphDids.publisher, sortDirection: 'sideways' },
    },
  ];

  for (const { nsid, params } of cases) {
    const { response, body } = await request(nsid, params);
    assert.equal(response.status, 500, `${nsid}: ${JSON.stringify(body)}`);
    assert.equal(body.error, 'script_error');
    assert.equal(body.errorType, 'runtime');
    assert.equal(body.method, nsid);
    assert.match(body.message, /InvalidRequest/);
  }
});
