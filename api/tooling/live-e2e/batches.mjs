import assert from 'node:assert/strict';
import { Gap } from './runtime.mjs';

const definitions = {
  'app.certified.graph.getFollows': { key: 'subjects', echo: 'subject', collection: 'app.certified.graph.follow', single: 'app.certified.graph.getFollow' },
  'app.certified.graph.getEntityFollows': { key: 'entities', echo: 'entity', collection: 'app.certified.graph.entityFollow', single: 'app.certified.graph.getEntityFollow' },
  'app.certified.feed.getReactionCounts': { key: 'subjects', echo: 'subject' },
  'app.certified.feed.getActorReactions': { key: 'subjects', echo: 'subject', actor: true },
};
export const batchDefinition = nsid => definitions[nsid];

/** Keep real target occurrences, including a duplicate, without inventing absent relationships. */
export function batchParams(endpoint, seeds, validator) {
  const definition = batchDefinition(endpoint.nsid);
  const rows = definition.collection ? seeds.filter(row => row?.record?.$type === definition.collection) : seeds;
  for (const anchor of rows) {
    const actor = anchor.did;
    const candidates = definition.collection
      ? rows.map(row => typeof row.record.subject === 'string' ? row.record.subject : row.record.subject?.uri)
      : rows.map(row => row?.uri);
    const targets = [...new Set(candidates.filter(value => typeof value === 'string'))].slice(0, 2);
    if (!targets.length) continue;
    const query = { [definition.key]: [...targets, targets[0]], ...(definition.collection || definition.actor ? { actor } : {}) };
    try { validator.assertValidXrpcParams(endpoint.nsid, query); return query; } catch { /* Try another public discovery anchor. */ }
  }
  throw new Gap(`No usable batch discovery anchor for ${endpoint.nsid}.`);
}

async function actorReactionRecords(query, kind, call, pages) {
  const records = new Map();
  let cursor;
  const cursors = new Set();
  for (let page = 0; page < pages; page++) {
    const body = await call(`app.certified.feed.getActor${kind}`, { actor: query.actor, limit: 100, ...(cursor ? { cursor } : {}) });
    for (const record of body[kind.toLowerCase()]) records.set(record.record.subject.uri, record);
    cursor = body.cursor;
    if (!cursor) return { records, complete: true };
    assert.ok(!cursors.has(cursor), 'Actor reaction comparison cursor repeated');
    cursors.add(cursor);
  }
  return { records, complete: false };
}

/** Compare batch output to independent existing queries; concurrent indexing can change either read. */
export async function checkBatch(endpoint, query, body, call, pages) {
  const definition = batchDefinition(endpoint.nsid);
  const results = body[endpoint.resultKey];
  assert.ok(Array.isArray(results), 'Batch response must be an array');
  assert.deepEqual(results.map(row => row[definition.echo]), query[definition.key], 'Batch must preserve target order and duplicate occurrences');
  const references = new Map();
  let likes, reposts;
  if (definition.actor) {
    likes = await actorReactionRecords(query, 'Likes', call, pages);
    reposts = await actorReactionRecords(query, 'Reposts', call, pages);
  }
  for (const row of results) {
    const target = row[definition.echo];
    if (references.has(target)) { assert.deepEqual(row, references.get(target), 'Duplicate targets returned different results'); continue; }
    references.set(target, row);
    if (definition.single) {
      const expected = await call(definition.single, { actor: query.actor, [definition.echo]: target });
      assert.deepEqual(row.follow, expected.follow, 'Batch relationship differs from single lookup; inspect concurrent indexing');
      if (row.follow !== null) {
        assert.equal(row.follow.did, query.actor, 'Batch relationship actor mismatch');
        const subject = row.follow.record.subject;
        assert.equal(typeof subject === 'string' ? subject : subject.uri, target, 'Batch relationship target mismatch');
      }
    } else if (definition.actor) {
      for (const [field, source] of [['like', likes], ['repost', reposts]]) {
        if (!source.records.has(target) && !source.complete) throw new Gap('Actor reaction history is truncated; absence cannot establish a null result.');
        const expected = source.records.get(target) ?? null;
        if (row[field] !== null) {
          assert.equal(row[field].did, query.actor, 'Actor reaction publisher mismatch');
          assert.equal(row[field].record.subject.uri, target, 'Actor reaction subject mismatch');
        }
        assert.deepEqual(row[field], expected, 'Batch actor reaction differs from actor history; inspect concurrent indexing');
      }
    } else {
      const like = await call('app.certified.feed.getLikes', { subject: target, limit: 1 });
      const repost = await call('app.certified.feed.getReposts', { subject: target, limit: 1 });
      assert.equal(row.likeCount, like.likeCount, 'Batch like count differs from subject count; inspect concurrent indexing');
      assert.equal(row.repostCount, repost.repostCount, 'Batch repost count differs from subject count; inspect concurrent indexing');
    }
  }
}
