import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const ACKNOWLEDGEMENT = 'org.hypercerts.context.acknowledgement';
const PROFILE = 'app.certified.actor.profile';
const ORGANIZATION = 'app.certified.actor.organization';
const authorDid = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const acknowledgementUri = `at://${authorDid}/${ACKNOWLEDGEMENT}/ack-one`;
const subjectUri = 'at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/org.hypercerts.claim.activity/activity-one';
const contextUri = 'at://did:plc:cccccccccccccccccccc/org.hypercerts.collection/collection-one';
const createdAt = '2025-01-02T03:04:05Z';
const acknowledgementRecord = {
  $type: ACKNOWLEDGEMENT,
  acknowledged: true,
  comment: 'The subject is supported.',
  subject: { uri: subjectUri, cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  context: { uri: contextUri, cid: 'bafyreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  createdAt,
  extension: { preserve: true },
};

function lua(value) {
  if (value === null) return 'nil';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `{${value.map(lua).join(',')}}`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `[${JSON.stringify(key)}]=${lua(item)}`).join(',')}}`;
  }
  throw new TypeError(`Cannot encode ${typeof value} as a Lua fixture`);
}

function databaseRow(row) {
  const result = { ...row };
  delete result.record_json;
  return result;
}

const acknowledgementRow = {
  uri: acknowledgementUri,
  did: authorDid,
  cid: 'bafyreiffffffffffffffffffffffffffffffffffffffffffffffffffff',
  indexed_at: createdAt,
  record: 'acknowledgement-record',
  record_json: acknowledgementRecord,
};
const authorProfile = {
  uri: `at://${authorDid}/${PROFILE}/self`, did: authorDid, cid: 'bafyreigggggggggggggggggggggggggggggggggggggggggggggggggg',
  indexed_at: createdAt, record: 'author-profile', record_json: { $type: PROFILE, displayName: 'Acknowledgement publisher' },
};
const authorOrganization = {
  uri: `at://${authorDid}/${ORGANIZATION}/self`, did: authorDid, cid: 'bafyreihhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
  indexed_at: createdAt, record: 'author-organization', record_json: { $type: ORGANIZATION, organizationType: ['nonprofit'] },
};

function runGetAcknowledgement() {
  const queryResults = [[acknowledgementRow], [authorProfile], [authorOrganization]];
  const rows = queryResults.flat();
  const records = Object.fromEntries(rows.map(({ record, record_json }) => [record, record_json]));
  const databaseResults = queryResults.map((result) => result.map(databaseRow));
  const source = `
local RECORDS = ${lua(records)}
local RESULTS = ${lua(databaseResults)}
local NULL = {}
local calls = {}
json = {
  decode = function(value)
    if value == 'null' then return NULL end
    return assert(RECORDS[value], 'unknown record fixture: ' .. value)
  end,
}
toarray = function(value) return value end
params = { uri = '${acknowledgementUri}' }
db = {
  backend = function() return 'postgres' end,
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    return RESULTS[#calls] or {}
  end,
}
dofile('lua/endpoints/getAcknowledgement.lua')
local ok, result = pcall(handle)
assert(ok, tostring(result))
local view = result.acknowledgement
assert(view.uri == '${acknowledgementUri}' and view.cid == '${acknowledgementRow.cid}')
assert(view.indexedAt == '${createdAt}' and view.did == '${authorDid}')
assert(view.record['$type'] == '${ACKNOWLEDGEMENT}' and view.record.acknowledged == true)
assert(view.record.comment == 'The subject is supported.' and view.record.createdAt == '${createdAt}')
assert(view.record.subject.uri == '${subjectUri}' and view.record.subject.cid == 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
assert(view.record.context.uri == '${contextUri}' and view.record.context.cid == 'bafyreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
assert(view.record.extension.preserve == true and view.status == nil)
assert(view.author.did == '${authorDid}')
assert(view.author.profile.uri == '${authorProfile.uri}' and view.author.profile.record.displayName == 'Acknowledgement publisher')
assert(view.author.organization.uri == '${authorOrganization.uri}' and view.author.organization.record.organizationType[1] == 'nonprofit')
assert(#calls == 3, 'perform exact lookup and publisher-profile/organization hydration')
assert(calls[1].values[1] == '${ACKNOWLEDGEMENT}' and calls[1].values[2] == '${acknowledgementUri}')
`;
  return spawnSync('lua5.4', ['-e', source], { cwd: root, encoding: 'utf8' });
}

function runListAcknowledgements() {
  const otherAuthorDid = 'did:plc:dddddddddddddddddddddddd';
  const otherSubjectUri = 'at://did:plc:eeeeeeeeeeeeeeeeeeee/org.hypercerts.collection/collection-two';
  const firstUri = `at://${authorDid}/${ACKNOWLEDGEMENT}/ack-first`;
  const secondUri = `at://${otherAuthorDid}/${ACKNOWLEDGEMENT}/ack-second`;
  const firstRecord = { ...acknowledgementRecord, createdAt: '2025-01-01T00:00:00Z' };
  const secondRecord = {
    ...acknowledgementRecord,
    subject: { uri: otherSubjectUri, cid: 'bafyreicccccccccccccccccccccccccccccccccccccccccccccccccccc' },
    createdAt: '2025-01-02T00:00:00Z',
  };
  const page = [
    { ...acknowledgementRow, uri: firstUri, record: 'first-record', record_json: firstRecord, sort_timestamp: '2025-01-01T00:00:00.000000Z' },
    { ...acknowledgementRow, uri: secondUri, did: otherAuthorDid, record: 'second-record', record_json: secondRecord, sort_timestamp: '2025-01-02T00:00:00.000000Z' },
  ];
  const queryResults = [page, [], []];
  const rows = queryResults.flat();
  const records = Object.fromEntries(rows.map(({ record, record_json }) => [record, record_json]));
  const databaseResults = queryResults.map((result) => result.map(databaseRow));
  const source = `
local RECORDS = ${lua(records)}
local RESULTS = ${lua(databaseResults)}
local NULL = {}
local calls = {}
local function decode_cursor(value)
  return {
    v = tonumber(value:match('"v":(%d+)')),
    d = value:match('"d":"([^"]*)"'),
    t = value:match('"t":"([^"]*)"'),
    u = value:match('"u":"([^"]*)"'),
  }
end
json = {
  decode = function(value)
    if value == 'null' then return NULL end
    if RECORDS[value] then return RECORDS[value] end
    if value:sub(1, 1) == '{' then return decode_cursor(value) end
    error('unexpected JSON fixture: ' .. value)
  end,
  encode = function(value)
    return string.format('{"v":%d,"d":"%s","t":"%s","u":"%s"}', value.v, value.d, value.t, value.u)
  end,
}
toarray = function(value) return value end
params = {
  authors = { '${authorDid}', '${authorDid}', '${otherAuthorDid}' },
  subjects = { '${subjectUri}', '${otherSubjectUri}', '${subjectUri}' },
  sortDirection = 'asc',
  limit = '1',
}
db = {
  backend = function() return 'postgres' end,
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    return RESULTS[#calls] or {}
  end,
}
dofile('lua/endpoints/listAcknowledgements.lua')
local ok, result = pcall(handle)
assert(ok, tostring(result))
assert(#result.acknowledgements == 1 and result.acknowledgements[1].uri == '${firstUri}')
local view = result.acknowledgements[1]
assert(view.record.subject.uri == '${subjectUri}' and view.record.subject.cid == 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
assert(view.author.did == '${authorDid}' and view.author.profile == NULL and view.author.organization == NULL)
assert(result.cursor ~= nil)
local cursor_json = result.cursor:gsub('..', function(pair) return string.char(tonumber(pair, 16)) end)
local cursor = json.decode(cursor_json)
assert(cursor.v == 1 and cursor.d == 'asc' and cursor.t == '2025-01-01T00:00:00.000000Z' and cursor.u == '${firstUri}')
assert(calls[1].values[1] == '${ACKNOWLEDGEMENT}' and calls[1].values[2] == '${authorDid}' and calls[1].values[3] == '${otherAuthorDid}')
assert(calls[1].values[4] == '${subjectUri}' and calls[1].values[5] == '${otherSubjectUri}' and calls[1].values[6] == 2)
assert(calls[1].sql:find('acknowledgement.did IN ($2, $3)', 1, true))
assert(calls[1].sql:find("acknowledgement.record::jsonb->'subject'->>'uri' IN ($4, $5)", 1, true))
assert(calls[1].sql:find('ORDER BY sorted.sort_at ASC, acknowledgement.uri ASC', 1, true))
assert(not calls[1].sql:find("subject'->>'cid'", 1, true), 'subject matching ignores CID')
assert(#calls[2].values == 2 and calls[2].values[2] == '${authorDid}', 'lookahead rows are not hydrated')
`;
  return spawnSync('lua5.4', ['-e', source], { cwd: root, encoding: 'utf8' });
}

function runGetErrorCases() {
  const source = `
local NULL = {}
local calls, fail_at, return_record = 0, 0, false
local query_values = {}
json = { decode = function(value) if value == 'null' then return NULL end return {} end }
toarray = function(value) return value end
params = { uri = 'at://author.example/${ACKNOWLEDGEMENT}/ack-one' }
db = {
  backend = function() return 'postgres' end,
  raw = function(_, values)
    calls = calls + 1
    query_values[calls] = values
    if calls == fail_at then error('fixture database failure') end
    if return_record and values[1] == '${ACKNOWLEDGEMENT}' then
      return {{ uri = '${acknowledgementUri}', did = '${authorDid}', cid = '${acknowledgementRow.cid}', indexed_at = '${createdAt}', record = 'acknowledgement-record' }}
    end
    return {}
  end,
}
dofile('lua/endpoints/getAcknowledgement.lua')
local ok, result = pcall(handle)
assert(not ok and tostring(result):find('InvalidRequest:', 1, true))
local broad_uri = 'at://did:plc:publisher%GG/${ACKNOWLEDGEMENT}/ack-one'
params = { uri = broad_uri }
ok, result = pcall(handle)
assert(not ok and tostring(result):find('RecordNotFound:', 1, true))
assert(calls == 1 and query_values[1][2] == broad_uri, 'opaque percent sequences must reach exact lookup unchanged')
params = { uri = 'at://did:plc:publisher%/${ACKNOWLEDGEMENT}/ack-one' }
ok, result = pcall(handle)
assert(not ok and tostring(result):find('InvalidRequest:', 1, true), 'trailing percent remains invalid')
assert(calls == 1, 'invalid DID boundary must fail before querying')
params = { uri = '${acknowledgementUri}' }
ok, result = pcall(handle)
assert(not ok and tostring(result):find('RecordNotFound:', 1, true))
assert(calls == 2, 'valid missing URI performs one indexed lookup')
return_record, fail_at = true, 4
ok, result = pcall(handle)
assert(not ok and tostring(result):find('AcknowledgementQueryFailed:', 1, true))
assert(not tostring(result):find('RecordNotFound:', 1, true), 'hydration failure is not reported as a missing record')
assert(calls == 4, 'publisher hydration failure reaches the PostgreSQL lookup')
`;
  return spawnSync('lua5.4', ['-e', source], { cwd: root, encoding: 'utf8' });
}

function runInvalidListParams() {
  const mismatchedCursor = Buffer.from(JSON.stringify({
    v: 1, d: 'asc', t: '2025-01-01T00:00:00.000000Z', u: acknowledgementUri,
  })).toString('hex');
  const yearZeroCursor = Buffer.from(JSON.stringify({
    v: 1, d: 'desc', t: '0000-01-01T00:00:00.000000Z', u: acknowledgementUri,
  })).toString('hex');
  const broadCursorUri = 'at://did:plc:publisher%GG/org.hypercerts.context.acknowledgement/ack-one';
  const broadCursor = Buffer.from(JSON.stringify({
    v: 1, d: 'desc', t: '2025-01-01T00:00:00.000000Z', u: broadCursorUri,
  })).toString('hex');
  const invalidCases = [
    { unknown: 'x' },
    { authors: ['alice.example'] },
    { authors: ['did:plc:publisher%'] },
    { authors: Array(101).fill(authorDid) },
    { authors: [authorDid, 42] },
    { subjects: ['at://alice.example/org.hypercerts.claim.activity/activity-one'] },
    { subjects: ['at://did:plc:publisher%/org.hypercerts.claim.activity/activity-one'] },
    { subjects: ['at://did:plc:bbbbbbbbbbbbbbbb/org/activity-one'] },
    { limit: '0' },
    { limit: '101' },
    { limit: ['1', '2'] },
    { sortDirection: 'sideways' },
    { cursor: '00' },
    { cursor: yearZeroCursor },
    { sortDirection: 'desc', cursor: mismatchedCursor },
  ];
  const source = `
local NULL = {}
local calls = 0
local query_values = {}
local function decode_cursor(value)
  return {
    v = tonumber(value:match('"v":(%d+)')),
    d = value:match('"d":"([^"]*)"'),
    t = value:match('"t":"([^"]*)"'),
    u = value:match('"u":"([^"]*)"'),
  }
end
json = {
  decode = function(value)
    if value == 'null' then return NULL end
    if value:sub(1, 1) == '{' then return decode_cursor(value) end
    error('malformed JSON')
  end,
  encode = function(value) return '{}' end,
}
toarray = function(value) return value end
db = {
  backend = function() return 'postgres' end,
  raw = function(_, values)
    calls = calls + 1
    query_values[calls] = values
    return {}
  end,
}
dofile('lua/endpoints/listAcknowledgements.lua')
local cases = ${lua(invalidCases)}
for _, query in ipairs(cases) do
  params = query
  local ok, result = pcall(handle)
  assert(not ok and tostring(result):find('InvalidRequest:', 1, true), 'invalid parameters must be rejected')
end
assert(calls == 0, 'invalid parameters are rejected before querying')
local broad_did = 'did:plc:publisher%GG'
local broad_subject = 'at://' .. broad_did .. '/org.hypercerts.claim.activity/activity-one'
params = { authors = { broad_did }, subjects = { broad_subject } }
local filtered = handle()
assert(#filtered.acknowledgements == 0)
assert(calls == 1 and query_values[1][2] == broad_did and query_values[1][3] == broad_subject,
  'broad author and subject DIDs must reach the list query unchanged')
params = { cursor = '${broadCursor}' }
local paged = handle()
assert(#paged.acknowledgements == 0 and calls == 2 and query_values[2][3] == '${broadCursorUri}',
  'broad DID cursor URI must reach the list query unchanged')
`;
  return spawnSync('lua5.4', ['-e', source], { cwd: root, encoding: 'utf8' });
}

function runEmptyListPages() {
  const source = `
local NULL = {}
local calls, fail_query = {}, false
json = {
  decode = function(value) if value == 'null' then return NULL end error('unexpected JSON') end,
  encode = function(value) return '{}' end,
}
toarray = function(value) return value end
params = {}
db = {
  backend = function() return 'postgres' end,
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    if fail_query then error('fixture database failure') end
    return {}
  end,
}
dofile('lua/endpoints/listAcknowledgements.lua')
local first = handle()
assert(#first.acknowledgements == 0 and first.cursor == nil)
assert(calls[1].values[1] == '${ACKNOWLEDGEMENT}' and calls[1].values[2] == 26)
assert(calls[1].sql:find('ORDER BY sorted.sort_at DESC, acknowledgement.uri DESC', 1, true))
params = { limit = '100' }
local second = handle()
assert(#second.acknowledgements == 0 and second.cursor == nil)
assert(calls[2].values[2] == 101, 'the maximum page size fetches one lookahead row')
fail_query = true
local ok, failure = pcall(handle)
assert(not ok and tostring(failure):find('AcknowledgementQueryFailed:', 1, true))
`;
  return spawnSync('lua5.4', ['-e', source], { cwd: root, encoding: 'utf8' });
}

test('getAcknowledgement accepts broad DID syntax and preserves invalid-URI and query failures', () => {
  const result = runGetErrorCases();
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('listAcknowledgements rejects malformed filters, bounds, scalars, and direction-mismatched cursors', () => {
  const result = runInvalidListParams();
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('listAcknowledgements is global by default, uses 25 records, allows 100, and omits end cursors', () => {
  const result = runEmptyListPages();
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('listAcknowledgements combines OR filters, sorts stably, hydrates only returned rows, and emits a direction-bound cursor', () => {
  const result = runListAcknowledgements();
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

function runNullIndexedAt() {
  const row = { ...acknowledgementRow, indexed_at: null, record: 'null-indexed-at-record' };
  const profile = { ...authorProfile, indexed_at: null, record: 'null-indexed-at-profile' };
  const organization = { ...authorOrganization, indexed_at: null, record: 'null-indexed-at-organization' };
  const queryResults = [[row], [profile], [organization]];
  const rows = queryResults.flat();
  const records = Object.fromEntries(rows.map(({ record, record_json }) => [record, record_json]));
  const databaseResults = queryResults.map((result) => result.map(databaseRow));
  const source = `
local RECORDS = ${lua(records)}
local RESULTS = ${lua(databaseResults)}
local NULL = {}
local calls = 0
json = { decode = function(value) if value == 'null' then return NULL end return assert(RECORDS[value]) end }
toarray = function(value) return value end
params = { uri = '${acknowledgementUri}' }
db = {
  backend = function() return 'postgres' end,
  raw = function() calls = calls + 1; return RESULTS[calls] or {} end,
}
dofile('lua/endpoints/getAcknowledgement.lua')
local result = handle()
local view = result.acknowledgement
assert(view.uri == '${acknowledgementUri}' and view.record.acknowledged == true)
assert(view.indexedAt == NULL, 'a null indexed timestamp is serialized as JSON null')
assert(view.author.profile.indexedAt == NULL and view.author.organization.indexedAt == NULL)
assert(view.author.profile.record.displayName == 'Acknowledgement publisher')
assert(view.author.organization.record.organizationType[1] == 'nonprofit')
assert(calls == 3)
`;
  return spawnSync('lua5.4', ['-e', source], { cwd: root, encoding: 'utf8' });
}

function runTimestampFallback() {
  const otherAuthorDid = 'did:plc:dddddddddddddddddddddddd';
  const firstUri = `at://${authorDid}/${ACKNOWLEDGEMENT}/missing-created-at`;
  const secondUri = `at://${authorDid}/${ACKNOWLEDGEMENT}/bad-created-at`;
  const thirdUri = `at://${otherAuthorDid}/${ACKNOWLEDGEMENT}/lookahead`;
  const rows = [
    {
      ...acknowledgementRow,
      uri: firstUri,
      indexed_at: '2025-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
      record: 'missing-created-at-record',
      record_json: {
        $type: ACKNOWLEDGEMENT,
        acknowledged: true,
        subject: acknowledgementRecord.subject,
        context: acknowledgementRecord.context,
        comment: acknowledgementRecord.comment,
      },
      sort_timestamp: '2025-01-01T00:00:00.000000Z',
    },
    {
      ...acknowledgementRow,
      uri: secondUri,
      indexed_at: null,
      created_at: '2026-01-01T00:00:00Z',
      record: 'bad-created-at-record',
      record_json: { ...acknowledgementRecord, createdAt: 'not-a-datetime' },
      sort_timestamp: '2026-01-01T00:00:00.000000Z',
    },
    {
      ...acknowledgementRow,
      uri: thirdUri,
      did: otherAuthorDid,
      created_at: '2027-01-01T00:00:00Z',
      record: 'lookahead-record',
      record_json: acknowledgementRecord,
      sort_timestamp: '2027-01-01T00:00:00.000000Z',
    },
  ];
  const queryResults = [[rows[0], rows[1]], [], [], [rows[1], rows[2]], [], []];
  const allRows = queryResults.flat();
  const records = Object.fromEntries(allRows.map(({ record, record_json }) => [record, record_json]));
  const databaseResults = queryResults.map((result) => result.map(databaseRow));
  const source = `
local RECORDS = ${lua(records)}
local RESULTS = ${lua(databaseResults)}
local NULL = {}
local calls = {}
local function decode_cursor(value)
  return {
    v = tonumber(value:match('"v":(%d+)')),
    d = value:match('"d":"([^"]*)"'),
    t = value:match('"t":"([^"]*)"'),
    u = value:match('"u":"([^"]*)"'),
  }
end
json = {
  decode = function(value)
    if value == 'null' then return NULL end
    if RECORDS[value] then return RECORDS[value] end
    if value:sub(1, 1) == '{' then return decode_cursor(value) end
    error('unexpected JSON fixture: ' .. value)
  end,
  encode = function(value)
    return string.format('{"v":%d,"d":"%s","t":"%s","u":"%s"}', value.v, value.d, value.t, value.u)
  end,
}
toarray = function(value) return value end
params = { sortDirection = 'asc', limit = '1' }
db = {
  backend = function() return 'postgres' end,
  raw = function(sql, values) calls[#calls + 1] = { sql = sql, values = values }; return RESULTS[#calls] or {} end,
}
dofile('lua/endpoints/listAcknowledgements.lua')
local first = handle()
assert(#first.acknowledgements == 1 and first.acknowledgements[1].uri == '${firstUri}')
assert(first.acknowledgements[1].record.createdAt == nil, 'the source record remains unchanged')
local first_cursor_json = first.cursor:gsub('..', function(pair) return string.char(tonumber(pair, 16)) end)
local first_cursor = json.decode(first_cursor_json)
assert(first_cursor.t == '2025-01-01T00:00:00.000000Z' and first_cursor.u == '${firstUri}')
params.cursor = first.cursor
local second = handle()
assert(#second.acknowledgements == 1 and second.acknowledgements[1].uri == '${secondUri}')
assert(second.acknowledgements[1].record.createdAt == 'not-a-datetime', 'malformed record timestamp is preserved')
assert(second.acknowledgements[1].indexedAt == NULL)
local second_cursor_json = second.cursor:gsub('..', function(pair) return string.char(tonumber(pair, 16)) end)
local second_cursor = json.decode(second_cursor_json)
assert(second_cursor.t == '2026-01-01T00:00:00.000000Z' and second_cursor.u == '${secondUri}')
assert(calls[1].sql:find('COALESCE(', 1, true))
assert(calls[1].sql:find('acknowledgement.indexed_at::timestamptz', 1, true))
assert(calls[1].sql:find('acknowledgement.created_at::timestamptz', 1, true))
assert(not calls[1].sql:find('sorted.sort_at IS NOT NULL', 1, true), 'bad createdAt rows use timestamp fallbacks instead of being dropped')
`;
  return spawnSync('lua5.4', ['-e', source], { cwd: root, encoding: 'utf8' });
}

test('null indexedAt remains explicit on acknowledgement and hydrated publisher views', () => {
  const result = runNullIndexedAt();
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('listAcknowledgements falls back from createdAt to indexed_at and stored created_at for stable cursors', () => {
  const result = runTimestampFallback();
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('getAcknowledgement returns the unchanged indexed record with its hydrated publisher', () => {
  const result = runGetAcknowledgement();
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});
