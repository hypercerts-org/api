import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';
import { graphDids, graphUris } from './fixtures/graph-follows.fixture.js';

const baseUrl = requireContractTarget();
const entityFollowCollection = 'app.certified.graph.entityFollow';

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

async function collectPages(nsid, outputKey, params, expectedUris) {
  const items = [];
  let cursor;
  for (let index = 0; index < expectedUris.length; index += 1) {
    const { response, body } = await request(nsid, { ...params, limit: 1, sortDirection: 'asc', cursor });
    assert.equal(response.status, 200, `${nsid}: ${JSON.stringify(body)}`);
    assert.equal(body[outputKey].length, 1);
    const [item] = body[outputKey];
    assert.equal(item.follow.uri, expectedUris[index]);
    items.push(item);
    cursor = body.cursor;
    if (index < expectedUris.length - 1) assert.equal(typeof cursor, 'string');
    else assert.equal(Object.hasOwn(body, 'cursor'), false);
  }
  return items;
}

test('getEntityFollow returns the earliest tied actor-entity record with its indexed timestamp', async () => {
  const { response, body } = await request('app.certified.graph.getEntityFollow', {
    actor: graphDids.publisher,
    entity: graphUris.followedFeature,
  });

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.follow.uri, `at://${graphDids.publisher}/${entityFollowCollection}/3jzfcijpj2z2a`);
  assert.equal(body.follow.$type, 'app.certified.graph.getEntityFollow#entityFollowRecordView');
  assert.equal(body.follow.did, graphDids.publisher);
  assert.equal(body.follow.indexedAt, '2025-03-01T00:00:00.000Z');
  assert.deepEqual(body.follow.record, {
    $type: entityFollowCollection,
    subject: { $type: 'app.certified.defs#recordSubject', uri: graphUris.followedFeature },
    createdAt: '2025-02-10T00:00:00.000Z',
  });
});

test('getEntityFollow returns explicit null for an unindexed actor-entity pair', async () => {
  const missingEntity = `at://${graphDids.entityAuthor}/org.hypercerts.entity.feature/3jzfcijpj2z2z`;
  const { response, body } = await request('app.certified.graph.getEntityFollow', {
    actor: graphDids.publisher,
    entity: missingEntity,
  });

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body, { follow: null });
});

test('listEntityFollowers filters by target, deduplicates tied records, paginates, and returns nullable sidecars', async () => {
  const items = await collectPages(
    'app.certified.graph.listEntityFollowers',
    'followers',
    { entity: graphUris.followedFeature },
    [
      `at://${graphDids.thirdFollower}/${entityFollowCollection}/3jzfcijpj2z2f`,
      `at://${graphDids.publisher}/${entityFollowCollection}/3jzfcijpj2z2a`,
      `at://${graphDids.secondPublisher}/${entityFollowCollection}/3jzfcijpj2z2e`,
    ],
  );

  assert.equal(items[0].did, graphDids.thirdFollower);
  assert.equal(items[0].$type, 'app.certified.graph.listEntityFollowers#entityFollowerView');
  assert.equal(items[0].follow.$type, 'app.certified.graph.getEntityFollow#entityFollowRecordView');
  assert.equal(items[0].follow.indexedAt, '2025-03-01T00:00:00.000Z');
  assert.equal(items[0].profile, null);
  assert.equal(items[0].organization, null);
  assert.equal(items[1].did, graphDids.publisher);
  assert.equal(items[1].profile.record.displayName, 'Graph Fixture Publisher');
  assert.deepEqual(items[1].organization.record.organizationType, ['nonprofit']);
  assert.equal(items[2].did, graphDids.secondPublisher);
  assert.equal(items[2].profile, null);
  assert.equal(items[2].organization, null);
});

test('listEntityFollowing resolves supported feature targets and preserves unresolved target URIs across tied pages', async () => {
  const nsid = 'app.certified.graph.listEntityFollowing';
  const actor = graphDids.publisher;
  const expectedFollowUris = [
    `at://${actor}/${entityFollowCollection}/3jzfcijpj2z2a`,
    `at://${actor}/${entityFollowCollection}/3jzfcijpj2z2c`,
    `at://${actor}/${entityFollowCollection}/3jzfcijpj2z2d`,
  ];
  const entities = [];
  let cursor;

  for (let index = 0; index < expectedFollowUris.length; index += 1) {
    const { response, body } = await request(nsid, { actor, limit: 1, sortDirection: 'asc', cursor });
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.entities.length, 1);
    const [item] = body.entities;
    assert.equal(item.$type, 'app.certified.graph.listEntityFollowing#entityFollowingItem');
    assert.equal(item.follow.$type, 'app.certified.graph.getEntityFollow#entityFollowRecordView');
    assert.equal(item.follow.uri, expectedFollowUris[index]);
    entities.push(item);
    cursor = body.cursor;
    if (index < expectedFollowUris.length - 1) assert.equal(typeof cursor, 'string');
    else assert.equal(Object.hasOwn(body, 'cursor'), false);
  }

  assert.equal(entities[0].uri, graphUris.followedFeature);
  assert.equal(entities[0].entity.$type, 'org.hypercerts.collection.listCollectionItems#featureView');
  assert.equal(entities[0].entity.record.title, 'Protected forest corridor');
  assert.equal(entities[0].entity.author.did, graphDids.entityAuthor);
  assert.equal(entities[0].entity.author.profile.record.displayName, 'Graph Feature Author');
  assert.equal(entities[0].entity.author.organization, null);
  assert.equal(entities[0].follow.indexedAt, '2025-03-01T00:00:00.000Z');

  assert.equal(entities[1].uri, graphUris.unresolvedFeature);
  assert.equal(entities[1].entity, null);
  assert.equal(entities[1].follow.record.subject.uri, graphUris.unresolvedFeature);

  assert.equal(entities[2].uri, graphUris.secondFeature);
  assert.equal(entities[2].entity.record.title, 'Community watershed');
});

test('entity-follow input failures use the pinned HappyView runtime error response', async () => {
  const cases = [
    {
      nsid: 'app.certified.graph.getEntityFollow',
      params: { actor: graphDids.publisher, entity: 'not-an-at-uri' },
    },
    {
      nsid: 'app.certified.graph.listEntityFollowers',
      params: { entity: graphUris.followedFeature, limit: 101 },
    },
    {
      nsid: 'app.certified.graph.listEntityFollowing',
      params: { actor: graphDids.publisher, limit: 101 },
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
