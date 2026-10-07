import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { jsonToLex, lexToJson } from '@atproto/lexicon';
import { validatePackageLexicons } from '../../../tooling/validate-lexicons.js';
import {
  reactionDids,
  reactionUris,
  seedRows as reactionFixtureRows,
} from '../../http/fixtures/feed-reactions.fixture.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const actor = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const secondActor = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const subject = 'at://did:plc:cccccccccccccccccccccccc/org.example.subject/item';
const indexedAt = '2025-01-02T03:04:05.000Z';
const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const collections = {
  Like: 'app.certified.feed.like',
  Repost: 'app.certified.feed.repost',
};

function reactionRow(kind, did, key, createdAt, extra = {}) {
  const collection = collections[kind];
  const uri = `at://${did}/${collection}/${key}`;
  const recordValue = {
    $type: collection,
    subject: { uri: subject, cid: `bafy-subject-${key}` },
    createdAt,
    ...extra,
  };
  return {
    uri,
    cid: `bafy-reaction-${key}`,
    did,
    indexed_at: indexedAt,
    record: `record-${key}`,
    recordValue,
    sort_timestamp: createdAt.replace('Z', '.000000Z'),
  };
}

function sidecarRow(collection, did, key, recordValue) {
  return {
    uri: `at://${did}/${collection}/self`,
    cid: `bafy-${key}`,
    did,
    indexed_at: indexedAt,
    record: `record-${key}`,
    recordValue,
  };
}

function lua(value) {
  if (value === null) return 'nil';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `{${value.map(lua).join(',')}}`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => `[${JSON.stringify(key)}]=${lua(item)}`)
      .join(',')}}`;
  }
  throw new TypeError(`Cannot encode ${typeof value} as a Lua fixture`);
}

function cursor({ direction = 'desc', timestamp = '2025-01-02T03:04:05.000000Z', uri } = {}) {
  return Buffer.from(JSON.stringify({
    v: 1,
    d: direction,
    t: timestamp,
    u: uri ?? `at://${actor}/${collections.Like}/cursor`,
  }), 'utf8').toString('hex');
}

function runLua({
  endpoint,
  params,
  rows = [],
  profiles = [],
  organizations = [],
  failure,
  backend = 'postgres',
  expectError,
  expectedCalls,
  assertions,
}) {
  const endpointPath = `lua/endpoints/${endpoint}.lua`;
  assert.ok(existsSync(`${root}/${endpointPath}`), `${endpointPath} must be generated before exercising the handler`);
  const records = Object.fromEntries([
    ...rows.filter(({ recordValue }) => recordValue).map(({ record, recordValue }) => [record, recordValue]),
    ...profiles.map(({ record, recordValue }) => [record, recordValue]),
    ...organizations.map(({ record, recordValue }) => [record, recordValue]),
  ]);
  const luaSource = `
local NULL_VALUE = {}
local RECORDS = ${lua(records)}
local rows = ${lua(rows)}
local profiles = ${lua(profiles)}
local organizations = ${lua(organizations)}
local calls = {}
local function decode_cursor(value)
  local version = tonumber(value:match('"v":(%d+)'))
  local direction = value:match('"d":"([^"]*)"')
  local timestamp = value:match('"t":"([^"]*)"')
  local uri = value:match('"u":"([^"]*)"')
  if not version or not direction or not timestamp or not uri then error('invalid cursor JSON') end
  return { v = version, d = direction, t = timestamp, u = uri }
end
json = {
  decode = function(value)
    if value == 'null' then return NULL_VALUE end
    if RECORDS[value] then return RECORDS[value] end
    if value:sub(1, 1) == '{' then return decode_cursor(value) end
    local decoded = value:gsub('..', function(pair) return string.char(tonumber(pair, 16)) end)
    return decode_cursor(decoded)
  end,
  encode = function(value)
    return string.format('{"v":%d,"d":"%s","t":"%s","u":"%s"}', value.v, value.d, value.t, value.u)
  end,
}
toarray = function(value) return value end
params = ${lua(params)}
db = {
  backend = function() return '${backend}' end,
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    if ${failure === 'reaction' ? 'true' : 'false'} and values[1] == '${collections.Like}' then error('injected query failure') end
    if ${failure === 'repost' ? 'true' : 'false'} and values[1] == '${collections.Repost}' then error('injected query failure') end
    if ${failure === 'profile' ? 'true' : 'false'} and values[1] == '${profileCollection}' then error('injected profile failure') end
    if ${failure === 'organization' ? 'true' : 'false'} and values[1] == '${organizationCollection}' then error('injected organization failure') end
    if values[1] == '${collections.Like}' or values[1] == '${collections.Repost}' then return rows end
    if values[1] == '${profileCollection}' then return profiles end
    if values[1] == '${organizationCollection}' then return organizations end
    error('unexpected collection ' .. tostring(values[1]))
  end,
}
dofile('${endpointPath}')
local ok, result = pcall(handle)
${expectError
    ? `assert(not ok, 'expected handler to reject the request')\nassert(tostring(result):find('${expectError}', 1, true), tostring(result))\nassert(#calls == ${expectedCalls ?? 0}, 'unexpected PostgreSQL query count')`
    : `assert(ok, tostring(result))\n${assertions ?? ''}`}
`;
  const result = spawnSync('lua5.4', ['-e', luaSource], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  return result.stdout;
}

test('getLikes returns distinct-actor count, page-only sidecars, and the complete raw like record', () => {
  const like = reactionRow('Like', actor, 'like-page', '2025-01-03T00:00:00Z', {
    via: { uri: 'at://did:plc:dddddddddddddddddddddddd/app.certified.feed.repost/via', cid: 'bafy-via' },
    signatures: [{ $type: 'app.certified.signature.defs#inline', signature: 'AQID', key: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa#key-1' }],
  });
  const lookahead = reactionRow('Like', secondActor, 'like-lookahead', '2025-01-02T00:00:00Z');
  like.total_count = 7;
  lookahead.total_count = 7;
  like.sort_timestamp = '2025-01-03T00:00:00.000000Z';
  lookahead.sort_timestamp = '2025-01-02T00:00:00.000000Z';
  const profile = sidecarRow(profileCollection, actor, 'profile', {
    $type: profileCollection, displayName: 'Liker',
  });
  runLua({
    endpoint: 'getLikes',
    params: { subject, limit: '1', sortDirection: 'desc' },
    rows: [like, lookahead],
    profiles: [profile],
    assertions: `
assert(result.likeCount == 7 and type(result.likeCount) == 'number')
assert(#result.likes == 1 and result.cursor ~= nil)
local item = result.likes[1]
assert(item.did == '${actor}' and item.profile.record.displayName == 'Liker')
assert(item.organization == NULL_VALUE)
assert(item.like.uri == '${like.uri}' and item.like.cid == '${like.cid}' and item.like.did == '${actor}')
assert(item.like.indexedAt == '${indexedAt}')
assert(item.like.record.subject.uri == '${subject}' and item.like.record.subject.cid == 'bafy-subject-like-page')
assert(item.like.record.via.uri == 'at://did:plc:dddddddddddddddddddddddd/app.certified.feed.repost/via')
assert(item.like.record.signatures[1].signature == 'AQID')
assert(item.like.via == nil and item.like.signatures == nil, 'record extensions stay inside the raw record')
assert(#calls == 3, 'query the page and hydrate only its profile and organization sidecars')
assert(calls[1].values[1] == '${collections.Like}' and calls[1].values[2] == '${subject}')
assert(calls[2].values[1] == '${profileCollection}' and calls[2].values[2] == '${actor}')
assert(calls[2].values[3] == nil, 'do not hydrate the lookahead actor')
assert(calls[3].values[1] == '${organizationCollection}' and calls[3].values[2] == '${actor}')
assert(calls[3].values[3] == nil, 'do not hydrate the lookahead actor')
local token_json = result.cursor:gsub('..', function(pair) return string.char(tonumber(pair, 16)) end)
local token = decode_cursor(token_json)
assert(token.v == 1 and token.d == 'desc' and token.t == '2025-01-03T00:00:00.000000Z' and token.u == '${like.uri}')
`,
  });
});

test('getReposts returns the complete page view and preserves a zero count on an empty page', () => {
  const repost = reactionRow('Repost', actor, 'repost-one', '2025-01-03T00:00:00Z', {
    via: { uri: 'at://did:plc:eeeeeeeeeeeeeeeeeeeeeeee/app.certified.feed.repost/origin', cid: 'bafy-origin' },
  });
  repost.total_count = 1;
  runLua({
    endpoint: 'getReposts',
    params: { subject },
    rows: [repost],
    assertions: `
assert(result.repostCount == 1 and #result.reposts == 1 and result.cursor == nil)
assert(result.reposts[1].did == '${actor}')
assert(result.reposts[1].profile == NULL_VALUE and result.reposts[1].organization == NULL_VALUE)
assert(result.reposts[1].repost.record.via.uri == 'at://did:plc:eeeeeeeeeeeeeeeeeeeeeeee/app.certified.feed.repost/origin')
assert(calls[1].values[1] == '${collections.Repost}' and calls[1].values[2] == '${subject}')
assert(calls[1].values[3] == 26, 'subject queries default to 25 and fetch one lookahead')
`,
  });

  runLua({
    endpoint: 'getReposts',
    params: { subject },
    rows: [{ total_count: 0 }],
    assertions: 'assert(result.repostCount == 0 and #result.reposts == 0 and result.cursor == nil)',
  });
});

test('actor queries return raw representative records without subject or actor hydration', () => {
  const like = reactionRow('Like', actor, 'actor-like', '2025-01-03T00:00:00Z');
  const repost = reactionRow('Repost', actor, 'actor-repost', '2025-01-02T00:00:00Z');
  for (const { endpoint, row, outputKey, collection } of [
    { endpoint: 'getActorLikes', row: like, outputKey: 'likes', collection: collections.Like },
    { endpoint: 'getActorReposts', row: repost, outputKey: 'reposts', collection: collections.Repost },
  ]) {
    runLua({
      endpoint,
      params: { actor },
      rows: [row],
      assertions: `
assert(#result.${outputKey} == 1 and result.cursor == nil)
assert(result.${outputKey}[1].uri == '${row.uri}' and result.${outputKey}[1].did == '${actor}')
assert(result.${outputKey}[1].record['$type'] == '${collection}')
assert(result.${outputKey}[1].record.subject.uri == '${subject}')
assert(result.${outputKey}[1].record.subject.cid == 'bafy-subject-${row.uri.split('/').at(-1)}')
assert(result.${outputKey}[1].profile == nil and result.${outputKey}[1].organization == nil, 'actor queries return raw records only')
assert(#calls == 1 and calls[1].values[1] == '${collection}' and calls[1].values[2] == '${actor}')
assert(calls[1].values[3] == 26, 'limit defaults to 25 and fetches one lookahead')
`,
    });
  }

  runLua({
    endpoint: 'getActorLikes',
    params: { actor, limit: '100' },
    assertions: 'assert(#result.likes == 0 and calls[1].values[3] == 101)',
  });
});

test('reaction requests reject invalid identifiers, repeated/unknown parameters, and malformed or mismatched cursors before querying', () => {
  const cases = [
    { endpoint: 'getLikes', params: { subject: 'alice.example' } },
    { endpoint: 'getReposts', params: { subject: 'at://alice.example/org.example.subject/key' } },
    { endpoint: 'getActorLikes', params: { actor: 'alice.example' } },
    { endpoint: 'getActorReposts', params: { actor, limit: '101' } },
    { endpoint: 'getLikes', params: { subject, limit: '0' } },
    { endpoint: 'getLikes', params: { subject, limit: { repeated: true } } },
    { endpoint: 'getReposts', params: { subject, sortDirection: 'sideways' } },
    { endpoint: 'getActorLikes', params: { actor, extra: 'unsupported' } },
    { endpoint: 'getActorReposts', params: { actor, cursor: 'not-hex' } },
    { endpoint: 'getLikes', params: { subject, cursor: cursor({ direction: 'asc' }), sortDirection: 'desc' } },
    { endpoint: 'getReposts', params: { subject, cursor: cursor({ uri: `at://${actor}/${collections.Like}/other` }) } },
  ];
  for (const { endpoint, params } of cases) {
    runLua({ endpoint, params, expectError: 'InvalidRequest:', expectedCalls: 0 });
  }
});

test('serialized feed-reaction fixtures validate against the pinned Lexicons and preserve URI versions and via', async () => {
  const { lexicons } = await validatePackageLexicons();
  const reactionCollections = new Set([collections.Like, collections.Repost]);
  const serializedRows = reactionFixtureRows
    .filter(({ collection }) => reactionCollections.has(collection))
    .map((row) => ({ ...row, serializedRecord: JSON.parse(JSON.stringify(row.record)) }));

  assert.ok(serializedRows.length > 0, 'expected HTTP reaction fixtures');
  for (const row of serializedRows) {
    const record = jsonToLex(row.serializedRecord);
    assert.doesNotThrow(() => lexicons.assertValidRecord(row.collection, record), row.uri);
    assert.deepEqual(lexToJson(record), row.serializedRecord, row.uri);
  }

  for (const collection of reactionCollections) {
    const subjectVersions = new Set(serializedRows
      .filter(({ collection: rowCollection, serializedRecord }) =>
        rowCollection === collection && serializedRecord.subject.uri === reactionUris.subject)
      .map(({ serializedRecord }) => serializedRecord.subject.cid));
    assert.ok(subjectVersions.size > 1, `${collection} retains multiple CIDs for one unindexed subject URI`);
  }

  const viaRecords = serializedRows.filter(({ serializedRecord }) => serializedRecord.via);
  assert.equal(viaRecords.length, 2);
  assert.ok(viaRecords.every(({ serializedRecord }) =>
    serializedRecord.via.uri === `at://${reactionDids.source}/app.certified.feed.repost/3jzfcijpj2z2a`));
});

test('reaction query and actor hydration failures use endpoint-specific errors without returning partial pages', () => {
  for (const { endpoint, kind, params, failure, expected } of [
    { endpoint: 'getLikes', kind: 'Like', params: { subject }, failure: 'reaction', expected: 'LikeQueryFailed:' },
    { endpoint: 'getActorReposts', kind: 'Repost', params: { actor }, failure: 'repost', expected: 'RepostQueryFailed:' },
    { endpoint: 'getReposts', kind: 'Repost', params: { subject }, failure: 'profile', expected: 'RepostQueryFailed:' },
  ]) {
    const row = reactionRow(kind, actor, `failure-${kind}`, '2025-01-03T00:00:00Z');
    row.total_count = 1;
    runLua({
      endpoint,
      params,
      rows: [row],
      failure,
      expectError: expected,
      expectedCalls: failure === 'profile' ? 2 : 1,
    });
  }
});
