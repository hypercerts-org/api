import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const uri = 'at://did:plc:abcdefghijklmnopqrstuvwx/org.hypercerts.vocab.tag/3jzfcijpj2z2z';
const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const sharedSources = [
  'lua/shared/didValidation.lua',
  'lua/shared/query.lua',
  'lua/shared/recordIdentifier.lua',
  'lua/shared/datetimeValidation.lua',
  'lua/shared/listValidation.lua',
  'lua/shared/listQuery.lua',
  'lua/shared/recordView.lua',
  'lua/shared/actorView.lua',
  'lua/shared/vocabTagValidation.lua',
];

function lua(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `{${value.map(lua).join(',')}}`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `[${JSON.stringify(key)}]=${lua(item)}`).join(',')}}`;
  }
  throw new TypeError(`Cannot encode ${typeof value} as a Lua fixture`);
}

async function runLua({ endpoint = 'getVocabTag', params, queryResults = [], assertions, expectError, failAt }) {
  const files = [...sharedSources, `lua/src/${endpoint}.lua`];
  const sources = await Promise.all(files.map((file) => readFile(path.resolve(root, file), 'utf8')));
  const recordJson = {
    'tag-record': {
      $type: 'org.hypercerts.vocab.tag',
      name: 'Climate action',
      broader: [{ uri: 'at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/org.hypercerts.vocab.tag/parent', cid: 'bafy-parent' }],
      sameAs: ['https://example.test/climate'],
    },
    'tag-malformed-date': {
      $type: 'org.hypercerts.vocab.tag',
      name: 'Old climate record',
      createdAt: 'not-a-datetime',
    },
    'profile-record': { $type: 'app.certified.actor.profile', displayName: 'Vocabulary publisher' },
    'organization-record': { $type: 'app.certified.actor.organization', organizationType: ['nonprofit'] },
  };
  const script = `
local RECORDS = ${lua(recordJson)}
local RESULTS = ${lua(queryResults)}
local NULL = {}
local calls = {}
json = {
  decode = function(value)
    if value == 'null' then return NULL end
    if RECORDS[value] then return RECORDS[value] end
    if value:sub(1, 1) == '{' then
      local version = tonumber(value:match('"v":(%d+)'))
      local direction = value:match('"d":"([^"]*)"')
      local filter = value:match('"f":"(.-)"')
      local timestamp = value:match('"t":"([^"]*)"')
      local uri = value:match('"u":"([^"]*)"')
      if not version or not direction or filter == nil or not timestamp or not uri then error('invalid cursor fixture') end
      return { v = version, d = direction, f = filter, t = timestamp, u = uri }
    end
    error('unexpected JSON fixture ' .. tostring(value))
  end,
  encode = function(value)
    return string.format('{"v":%d,"d":"%s","f":"%s","t":"%s","u":"%s"}', value.v, value.d, value.f, value.t, value.u)
  end,
}
toarray = function(value) return value end
params = ${lua(params)}
db = {
  backend = function() return 'postgres' end,
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    if ${failAt ?? 'nil'} == #calls then error('database unavailable') end
    return RESULTS[#calls] or {}
  end,
}
${sources.join('\n\n')}
local ok, result = pcall(handle)
${expectError
    ? `assert(not ok, 'expected handler to reject the request')\nassert(tostring(result):find(${JSON.stringify(expectError)}, 1, true), tostring(result))\n${assertions}`
    : `assert(ok, tostring(result))\n${assertions}`}
`;
  const result = spawnSync('lua5.4', ['-e', script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
}

const tagRow = {
  uri,
  did,
  cid: 'bafy-tag-version',
  indexed_at: '2025-02-01T00:00:01.000Z',
  record: 'tag-record',
};
const firstAuthor = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const secondAuthor = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const pageTimestamp = '2025-02-01T00:00:00.000000Z';
const secondUri = 'at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/org.hypercerts.vocab.tag/3jzfcijpj2z2z';

function listRow(recordUri, author, cid, sortTimestamp) {
  return {
    uri: recordUri,
    did: author,
    cid,
    indexed_at: '2025-02-01T00:00:01.000Z',
    record: 'tag-record',
    sort_timestamp: sortTimestamp,
  };
}

function sidecarRow(collection, author, record) {
  return {
    uri: `at://${author}/${collection}/self`,
    did: author,
    cid: `bafy-${collection}`,
    indexed_at: '2025-02-01T00:00:02.000Z',
    record,
  };
}

function cursor({ direction = 'asc', authors = [], timestamp = pageTimestamp, recordUri = uri } = {}) {
  const filter = [...new Set(authors)].sort().join(',');
  return Buffer.from(JSON.stringify({ v: 1, d: direction, f: filter, t: timestamp, u: recordUri }), 'utf8').toString('hex');
}

test('getVocabTag returns the exact indexed tag and hydrates its publisher sidecars', async () => {
  await runLua({
    params: { uri },
    queryResults: [[tagRow], [], []],
    assertions: `
assert(result.vocabTag.uri == '${uri}' and result.vocabTag.cid == 'bafy-tag-version')
assert(result.vocabTag.did == '${did}' and result.vocabTag.indexedAt == '2025-02-01T00:00:01.000Z')
assert(result.vocabTag.record['$type'] == 'org.hypercerts.vocab.tag')
assert(result.vocabTag.record.name == 'Climate action' and #result.vocabTag.record.broader == 1)
assert(result.vocabTag.record.sameAs[1] == 'https://example.test/climate')
assert(result.vocabTag.author.did == '${did}' and result.vocabTag.author.profile == NULL)
assert(result.vocabTag.author.organization == NULL)
assert(#calls == 3)
assert(calls[1].sql:find('WHERE collection = $1 AND uri = $2', 1, true))
assert(calls[1].values[1] == 'org.hypercerts.vocab.tag' and calls[1].values[2] == '${uri}')
assert(calls[2].values[1] == 'app.certified.actor.profile' and calls[2].values[2] == '${did}')
assert(calls[3].values[1] == 'app.certified.actor.organization' and calls[3].values[2] == '${did}')
`,
  });
});

test('getVocabTag preserves required indexedAt as JSON null when the index timestamp is absent', async () => {
  const row = { ...tagRow };
  delete row.indexed_at;
  await runLua({
    params: { uri },
    queryResults: [[row], [], []],
    assertions: `
assert(result.vocabTag.indexedAt == NULL)
assert(result.vocabTag.uri == '${uri}' and result.vocabTag.record.name == 'Climate action')
`,
  });
});

test('vocab tag sidecar timestamps are omitted when null while the tag timestamp remains explicit null', async () => {
  const tagWithoutIndexedAt = { ...tagRow };
  delete tagWithoutIndexedAt.indexed_at;
  const profileWithoutIndexedAt = {
    uri: `at://${did}/app.certified.actor.profile/self`,
    did,
    cid: 'bafy-profile-without-indexed-at',
    record: 'profile-record',
  };
  const organizationWithoutIndexedAt = {
    uri: `at://${did}/app.certified.actor.organization/self`,
    did,
    cid: 'bafy-organization-without-indexed-at',
    record: 'organization-record',
  };
  const sidecars = [profileWithoutIndexedAt, organizationWithoutIndexedAt];

  await runLua({
    params: { uri },
    queryResults: [[tagWithoutIndexedAt], [sidecars[0]], [sidecars[1]]],
    assertions: `
assert(result.vocabTag.indexedAt == NULL)
assert(result.vocabTag.author.profile.record.displayName == 'Vocabulary publisher')
assert(result.vocabTag.author.profile.indexedAt == nil)
assert(result.vocabTag.author.organization.record.organizationType[1] == 'nonprofit')
assert(result.vocabTag.author.organization.indexedAt == nil)
`,
  });

  await runLua({
    endpoint: 'listVocabTags',
    params: {},
    queryResults: [[tagWithoutIndexedAt], [sidecars[0]], [sidecars[1]]],
    assertions: `
assert(result.vocabTags[1].indexedAt == NULL)
assert(result.vocabTags[1].author.profile.record.displayName == 'Vocabulary publisher')
assert(result.vocabTags[1].author.profile.indexedAt == nil)
assert(result.vocabTags[1].author.organization.record.organizationType[1] == 'nonprofit')
assert(result.vocabTags[1].author.organization.indexedAt == nil)
`,
  });
});

test('getVocabTag reports RecordNotFound when the exact indexed URI is absent', async () => {
  await runLua({
    params: { uri },
    queryResults: [[]],
    expectError: 'RecordNotFound:',
    assertions: 'assert(#calls == 1)',
  });
});

test('getVocabTag preserves collection and DID boundary checks while broad DIDs reach lookup', async () => {
  for (const invalidUri of [
    'at://did:plc:abcdefghijklmnopqrstuvwx/org.hypercerts.collection/3jzfcijpj2z2z',
    'at://climate.example/org.hypercerts.vocab.tag/3jzfcijpj2z2z',
    'at://did:plc:abcdefghijklmnopqrstuvwx%/org.hypercerts.vocab.tag/3jzfcijpj2z2z',
  ]) {
    await runLua({
      params: { uri: invalidUri },
      expectError: 'InvalidRequest:',
      assertions: 'assert(#calls == 0)',
    });
  }

  const broadUri = 'at://did:plc:publisher%ZZ/org.hypercerts.vocab.tag/3jzfcijpj2z2z';
  await runLua({
    params: { uri: broadUri },
    queryResults: [[]],
    expectError: 'RecordNotFound:',
    assertions: `assert(#calls == 1 and calls[1].values[2] == '${broadUri}')`,
  });
});

test('listVocabTags defaults to 25 descending and omits a terminal cursor', async () => {
  await runLua({
    endpoint: 'listVocabTags',
    params: {},
    queryResults: [[]],
    assertions: `
assert(#result.vocabTags == 0 and result.cursor == nil)
assert(#calls == 1)
assert(calls[1].values[1] == 'org.hypercerts.vocab.tag' and calls[1].values[2] == 26)
assert(calls[1].sql:find('ORDER BY sorted.sort_at DESC, uri DESC', 1, true))
`,
  });
});

test('listVocabTags OR-filters authors, orders by createdAt and URI, and hydrates only the page', async () => {
  const firstUri = `at://${firstAuthor}/org.hypercerts.vocab.tag/first`;
  const first = listRow(firstUri, firstAuthor, 'bafy-first', pageTimestamp);
  const lookahead = listRow(secondUri, secondAuthor, 'bafy-next', '2025-02-02T00:00:00.000000Z');
  const profile = sidecarRow('app.certified.actor.profile', firstAuthor, 'profile-record');
  await runLua({
    endpoint: 'listVocabTags',
    params: { authors: [secondAuthor, firstAuthor, firstAuthor], sortDirection: 'asc', limit: '1' },
    queryResults: [[first, lookahead], [profile], []],
    assertions: `
assert(#result.vocabTags == 1 and result.vocabTags[1].uri == '${firstUri}')
assert(result.vocabTags[1].record.name == 'Climate action')
assert(result.vocabTags[1].author.did == '${firstAuthor}')
assert(result.vocabTags[1].author.profile.record.displayName == 'Vocabulary publisher')
assert(result.vocabTags[1].author.organization == NULL)
assert(calls[1].sql:find('did IN ($2,$3)', 1, true))
assert(calls[1].sql:find('ORDER BY sorted.sort_at ASC, uri ASC', 1, true))
assert(calls[1].values[1] == 'org.hypercerts.vocab.tag')
assert(calls[1].values[2] == '${firstAuthor}' and calls[1].values[3] == '${secondAuthor}' and calls[1].values[4] == 2)
assert(calls[2].values[1] == 'app.certified.actor.profile' and calls[2].values[2] == '${firstAuthor}')
assert(calls[3].values[1] == 'app.certified.actor.organization' and calls[3].values[2] == '${firstAuthor}')
local token = json.decode(result.cursor:gsub('..', function(pair) return string.char(tonumber(pair, 16)) end))
assert(token.v == 1 and token.d == 'asc' and token.f == '${firstAuthor},${secondAuthor}')
assert(token.t == '${pageTimestamp}' and token.u == '${firstUri}')
`,
  });
});

test('listVocabTags pages by indexedAt then row created_at fallback and keeps null indexedAt present', async () => {
  const malformedCreatedAtUri = `at://${firstAuthor}/org.hypercerts.vocab.tag/malformed-date`;
  const malformedCreatedAt = listRow(malformedCreatedAtUri, firstAuthor, 'bafy-malformed-date', '2025-02-01T00:00:01.000000Z');
  malformedCreatedAt.record = 'tag-malformed-date';
  const rowCreatedAt = listRow(secondUri, secondAuthor, 'bafy-row-created-at', '2025-02-02T00:00:00.000000Z');
  delete rowCreatedAt.indexed_at;
  rowCreatedAt.created_at = '2025-02-02T00:00:00.000Z';
  const lastUri = `at://${did}/org.hypercerts.vocab.tag/last`;
  const last = listRow(lastUri, did, 'bafy-last', '2025-02-03T00:00:00.000000Z');
  const firstFallback = '2025-02-01T00:00:01.000000Z';
  const rowFallback = '2025-02-02T00:00:00.000000Z';

  await runLua({
    endpoint: 'listVocabTags',
    params: { sortDirection: 'asc', limit: '1' },
    queryResults: [[malformedCreatedAt, rowCreatedAt], [], []],
    assertions: `
assert(#result.vocabTags == 1 and result.vocabTags[1].uri == '${malformedCreatedAtUri}')
assert(result.vocabTags[1].record.createdAt == 'not-a-datetime')
assert(calls[1].sql:find('COALESCE(indexed_at::timestamptz, created_at::timestamptz)', 1, true))
assert(calls[1].sql:find('ORDER BY sorted.sort_at ASC, uri ASC', 1, true))
local firstCursor = json.decode(result.cursor:gsub('..', function(pair) return string.char(tonumber(pair, 16)) end))
assert(firstCursor.t == '${firstFallback}' and firstCursor.u == '${malformedCreatedAtUri}')
`,
  });

  await runLua({
    endpoint: 'listVocabTags',
    params: { sortDirection: 'asc', limit: '1', cursor: cursor({ timestamp: firstFallback, recordUri: malformedCreatedAtUri }) },
    queryResults: [[rowCreatedAt, last], [], []],
    assertions: `
assert(#result.vocabTags == 1 and result.vocabTags[1].uri == '${secondUri}')
assert(result.vocabTags[1].indexedAt == NULL and result.vocabTags[1].record.createdAt == nil)
assert(calls[1].sql:find('(sorted.sort_at, uri) > (($2)::timestamptz, $3)', 1, true))
local nextCursor = json.decode(result.cursor:gsub('..', function(pair) return string.char(tonumber(pair, 16)) end))
assert(nextCursor.t == '${rowFallback}' and nextCursor.u == '${secondUri}')
`,
  });
});

test('listVocabTags resumes with the same author filter and direction-bound keyset', async () => {
  const continuation = cursor({ authors: [firstAuthor, secondAuthor], recordUri: `at://${firstAuthor}/org.hypercerts.vocab.tag/prior` });
  const next = listRow(secondUri, secondAuthor, 'bafy-next', '2025-02-02T00:00:00.000000Z');
  await runLua({
    endpoint: 'listVocabTags',
    params: { authors: [firstAuthor, secondAuthor], sortDirection: 'asc', limit: '1', cursor: continuation },
    queryResults: [[next], [], []],
    assertions: `
assert(#result.vocabTags == 1 and result.vocabTags[1].uri == '${secondUri}' and result.cursor == nil)
assert(calls[1].sql:find('(sorted.sort_at, uri) > (($4)::timestamptz, $5)', 1, true))
assert(calls[1].values[1] == 'org.hypercerts.vocab.tag')
assert(calls[1].values[2] == '${firstAuthor}' and calls[1].values[3] == '${secondAuthor}')
assert(calls[1].values[4] == '${pageTimestamp}' and calls[1].values[5] == 'at://${firstAuthor}/org.hypercerts.vocab.tag/prior')
assert(calls[1].values[6] == 2)
`,
  });
});

test('listVocabTags rejects invalid authors and cursor URIs, repeated scalars, and changed filters before querying', async () => {
  const mismatchedFilterCursor = cursor({ authors: [firstAuthor] });
  const directionCursor = cursor({ direction: 'desc', authors: [firstAuthor] });
  const malformedUriCursor = cursor({ recordUri: 'at://did:plc:abcdefghijklmnopqrstuvwx%/org.hypercerts.vocab.tag/rkey' });
  for (const params of [
    { authors: ['climate.example'] },
    { authors: ['did:plc:bad%'] },
    { authors: Array(101).fill(firstAuthor) },
    { limit: ['1', '2'] },
    { sortDirection: ['asc', 'desc'] },
    { cursor: [mismatchedFilterCursor, mismatchedFilterCursor] },
    { unknown: 'value' },
    { authors: [secondAuthor], sortDirection: 'asc', cursor: mismatchedFilterCursor },
    { authors: [firstAuthor], sortDirection: 'asc', cursor: directionCursor },
    { sortDirection: 'asc', cursor: malformedUriCursor },
  ]) {
    await runLua({
      endpoint: 'listVocabTags',
      params,
      expectError: 'InvalidRequest:',
      assertions: 'assert(#calls == 0)',
    });
  }
});

test('vocabulary tag queries accept opaque DID percent sequences in records, filters, and cursors', async () => {
  const escapedDid = 'did:plc:abcdefghijklmnopqrst%ZZ';
  const escapedUri = `at://${escapedDid}/org.hypercerts.vocab.tag/escaped`;
  const escapedRow = { ...tagRow, uri: escapedUri, did: escapedDid };
  await runLua({
    params: { uri: escapedUri },
    queryResults: [[escapedRow], [], []],
    assertions: `
assert(result.vocabTag.uri == '${escapedUri}' and result.vocabTag.did == '${escapedDid}')
assert(calls[1].values[2] == '${escapedUri}')
`,
  });
  await runLua({
    endpoint: 'listVocabTags',
    params: { authors: [escapedDid] },
    queryResults: [[]],
    assertions: `
assert(#result.vocabTags == 0)
assert(calls[1].values[2] == '${escapedDid}')
`,
  });

  const broadCursorUri = `at://${escapedDid}/org.hypercerts.vocab.tag/prior`;
  await runLua({
    endpoint: 'listVocabTags',
    params: { sortDirection: 'asc', cursor: cursor({ direction: 'asc', recordUri: broadCursorUri }) },
    queryResults: [[]],
    assertions: `
assert(#result.vocabTags == 0)
assert(calls[1].values[3] == '${broadCursorUri}')
`,
  });
});

test('listVocabTags rejects a year-zero cursor timestamp before querying', async () => {
  await runLua({
    endpoint: 'listVocabTags',
    params: { sortDirection: 'asc', cursor: cursor({ timestamp: '0000-01-01T00:00:00Z' }) },
    expectError: 'InvalidRequest: cursor timestamp year must be greater than 0000',
    assertions: 'assert(#calls == 0)',
  });
});

test('listVocabTags reports operational publisher-hydration failures instead of returning a partial page', async () => {
  await runLua({
    endpoint: 'listVocabTags',
    params: {},
    queryResults: [[tagRow], []],
    failAt: 2,
    expectError: 'VocabTagQueryFailed:',
    assertions: 'assert(#calls == 2)',
  });
});
