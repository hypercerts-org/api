import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';
import { reactionDids, reactionUris, seedRows, subjectCids } from './fixtures/feed-reactions.fixture.js';

const likesEndpoint = 'app.certified.feed.getLikes';
const repostsEndpoint = 'app.certified.feed.getReposts';
const actorLikesEndpoint = 'app.certified.feed.getActorLikes';
const actorRepostsEndpoint = 'app.certified.feed.getActorReposts';
const likeCollection = 'app.certified.feed.like';
const repostCollection = 'app.certified.feed.repost';

async function request(nsid, params) {
  const response = await fetch(contractUrl(requireContractTarget(), nsid, params), {
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
  assert.ok(row, `missing reaction fixture row ${uri}`);
  return row;
}

function recordView(row) {
  return {
    uri: row.uri,
    cid: row.cid,
    indexedAt: row.indexedAt,
    did: row.did,
    record: JSON.parse(JSON.stringify(row.record)),
  };
}

function expectedActorView(did, reactionCollection, rkey, relationKey) {
  const profile = seedRows.find((row) => row.did === did && row.collection === 'app.certified.actor.profile');
  const organization = seedRows.find((row) => row.did === did && row.collection === 'app.certified.actor.organization');
  const reaction = fixtureRow(`at://${did}/${reactionCollection}/${rkey}`);
  return {
    did,
    profile: profile ? recordView(profile) : null,
    organization: organization ? recordView(organization) : null,
    [relationKey]: recordView(reaction),
  };
}

test('getLikes paginates distinct actors by earliest reaction, ignores subject CID, and preserves raw record fields', async () => {
  const expected = [
    { did: reactionDids.actorA, uri: `at://${reactionDids.actorA}/${likeCollection}/3jzfcijpj2z2a`, hasNext: true },
    { did: reactionDids.actorB, uri: `at://${reactionDids.actorB}/${likeCollection}/3jzfcijpj2z2d`, hasNext: true },
    { did: reactionDids.actorC, uri: `at://${reactionDids.actorC}/${likeCollection}/3jzfcijpj2z2e`, hasNext: false },
  ];
  let cursor;
  const items = [];
  for (const [index, expectation] of expected.entries()) {
    const { response, body } = await request(likesEndpoint, {
      subject: reactionUris.subject,
      limit: 1,
      sortDirection: 'asc',
      cursor,
    });
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.likeCount, 3, 'count distinct authors across the entire result, not the page');
    assert.equal(body.likes.length, 1);
    const [item] = body.likes;
    assert.equal(item.did, expectation.did);
    assert.equal(item.like.uri, expectation.uri);
    assert.equal(item.like.record.$type, likeCollection);
    items.push(item);
    cursor = body.cursor;
    if (expectation.hasNext) assert.equal(typeof cursor, 'string');
    else assert.equal(Object.hasOwn(body, 'cursor'), false);
    assert.equal(body.likeCount, 3, `page ${index + 1} retains the total count`);
  }

  assert.deepEqual(items[0], expectedActorView(reactionDids.actorA, likeCollection, '3jzfcijpj2z2a', 'like'));
  assert.equal(items[0].like.record.subject.uri, reactionUris.subject);
  assert.equal(items[0].like.record.subject.cid, subjectCids.likeA);
  assert.equal(items[0].like.record.via.uri, `at://${reactionDids.source}/${repostCollection}/3jzfcijpj2z2a`);
  assert.deepEqual(items[0].like.record.signatures[0].signature, { $bytes: 'AQID' });
  assert.deepEqual(items[1], expectedActorView(reactionDids.actorB, likeCollection, '3jzfcijpj2z2d', 'like'));
  assert.deepEqual(items[2], expectedActorView(reactionDids.actorC, likeCollection, '3jzfcijpj2z2e', 'like'));
});

test('getLikes pages tied representatives in descending URI order', async () => {
  const expected = [
    { did: reactionDids.actorC, uri: `at://${reactionDids.actorC}/${likeCollection}/3jzfcijpj2z2e` },
    { did: reactionDids.actorB, uri: `at://${reactionDids.actorB}/${likeCollection}/3jzfcijpj2z2d` },
    { did: reactionDids.actorA, uri: `at://${reactionDids.actorA}/${likeCollection}/3jzfcijpj2z2a` },
  ];
  let cursor;
  for (const [index, expectation] of expected.entries()) {
    const { response, body } = await request(likesEndpoint, {
      subject: reactionUris.subject,
      limit: 1,
      sortDirection: 'desc',
      cursor,
    });
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.likeCount, expected.length);
    assert.equal(body.likes.length, 1);
    assert.equal(body.likes[0].did, expectation.did);
    assert.equal(body.likes[0].like.uri, expectation.uri);
    cursor = body.cursor;
    if (index < expected.length - 1) assert.equal(typeof cursor, 'string');
    else assert.equal(Object.hasOwn(body, 'cursor'), false);
  }
});

test('getReposts returns total distinct reposters and earliest raw reposts with nullable sidecars', async () => {
  const { response, body } = await request(repostsEndpoint, {
    subject: reactionUris.subject,
    limit: 10,
    sortDirection: 'asc',
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.repostCount, 2);
  assert.deepEqual(body.reposts.map(({ did, repost }) => [did, repost.uri]), [
    [reactionDids.actorA, `at://${reactionDids.actorA}/${repostCollection}/3jzfcijpj2z2a`],
    [reactionDids.actorD, `at://${reactionDids.actorD}/${repostCollection}/3jzfcijpj2z2d`],
  ]);
  assert.deepEqual(body.reposts[0], expectedActorView(reactionDids.actorA, repostCollection, '3jzfcijpj2z2a', 'repost'));
  assert.equal(body.reposts[0].repost.record.subject.cid, subjectCids.repostA);
  assert.equal(body.reposts[0].repost.record.via.uri, `at://${reactionDids.source}/${repostCollection}/3jzfcijpj2z2a`);
  assert.deepEqual(body.reposts[0].repost.record.signatures[0].signature, { $bytes: 'BAUG' });
  assert.deepEqual(body.reposts[1], expectedActorView(reactionDids.actorD, repostCollection, '3jzfcijpj2z2d', 'repost'));
  assert.equal(body.reposts[1].profile, null);
  assert.equal(body.reposts[1].organization, null);
});

test('actor reaction queries deduplicate subject URIs and return raw records without hydration or counts', async () => {
  for (const { endpoint, collection, outputKey, relationKey } of [
    { endpoint: actorLikesEndpoint, collection: likeCollection, outputKey: 'likes', relationKey: 'like' },
    { endpoint: actorRepostsEndpoint, collection: repostCollection, outputKey: 'reposts', relationKey: 'repost' },
  ]) {
    const { response, body } = await request(endpoint, {
      actor: reactionDids.actorA,
      limit: 10,
      sortDirection: 'asc',
    });
    assert.equal(response.status, 200, `${endpoint}: ${JSON.stringify(body)}`);
    assert.equal(Object.hasOwn(body, 'likeCount'), false);
    assert.equal(Object.hasOwn(body, 'repostCount'), false);
    assert.deepEqual(body[outputKey].map(({ record }) => record.subject.uri), [
      reactionUris.subject,
      reactionUris.otherSubject,
    ]);
    assert.deepEqual(body[outputKey].map(({ uri }) => uri), [
      `at://${reactionDids.actorA}/${collection}/3jzfcijpj2z2a`,
      `at://${reactionDids.actorA}/${collection}/3jzfcijpj2z2${collection === likeCollection ? 'f' : 'e'}`,
    ]);
    for (const item of body[outputKey]) {
      assert.equal(Object.hasOwn(item, 'profile'), false);
      assert.equal(Object.hasOwn(item, 'organization'), false);
      assert.equal(item.record.$type, collection);
      assert.equal(item.did, reactionDids.actorA);
    }
    const [first] = body[outputKey];
    assert.equal(first.record.via.uri, `at://${reactionDids.source}/${repostCollection}/3jzfcijpj2z2a`);
    assert.deepEqual(first.record.signatures[0].signature, { $bytes: collection === likeCollection ? 'AQID' : 'BAUG' });
    assert.equal(first[relationKey], undefined, 'actor endpoints expose raw record views, not subject actor views');
  }
});

test('actor reaction queries keyset-page URI ties in descending order without hydration', async () => {
  for (const { endpoint, collection, outputKey, otherKey } of [
    { endpoint: actorLikesEndpoint, collection: likeCollection, outputKey: 'likes', otherKey: '3jzfcijpj2z2f' },
    { endpoint: actorRepostsEndpoint, collection: repostCollection, outputKey: 'reposts', otherKey: '3jzfcijpj2z2e' },
  ]) {
    let cursor;
    const expected = [otherKey, '3jzfcijpj2z2a'];
    for (const [index, rkey] of expected.entries()) {
      const { response, body } = await request(endpoint, {
        actor: reactionDids.actorA,
        limit: 1,
        sortDirection: 'desc',
        cursor,
      });
      assert.equal(response.status, 200, `${endpoint}: ${JSON.stringify(body)}`);
      assert.equal(body[outputKey].length, 1);
      assert.equal(body[outputKey][0].uri, `at://${reactionDids.actorA}/${collection}/${rkey}`);
      assert.equal(body[outputKey][0].record.createdAt, '2025-02-01T00:00:00.000Z');
      assert.equal(Object.hasOwn(body[outputKey][0], 'profile'), false);
      cursor = body.cursor;
      if (index < expected.length - 1) assert.equal(typeof cursor, 'string');
      else assert.equal(Object.hasOwn(body, 'cursor'), false);
    }
  }
});

test('reaction endpoints expose named request errors for invalid pagination and identifiers', async () => {
  const cases = [
    { endpoint: likesEndpoint, params: { subject: 'alice.example' } },
    { endpoint: repostsEndpoint, params: { subject: reactionUris.subject, limit: 101 } },
    { endpoint: actorLikesEndpoint, params: { actor: 'alice.example' } },
    { endpoint: actorRepostsEndpoint, params: { actor: reactionDids.actorA, sortDirection: 'sideways' } },
  ];
  for (const { endpoint, params } of cases) {
    const { response, body } = await request(endpoint, params);
    assert.equal(response.status, 500, `${endpoint}: ${JSON.stringify(body)}`);
    assert.equal(body.error, 'script_error');
    assert.equal(body.errorType, 'runtime');
    assert.equal(body.method, endpoint);
    assert.match(body.message, /InvalidRequest/);
  }
});
