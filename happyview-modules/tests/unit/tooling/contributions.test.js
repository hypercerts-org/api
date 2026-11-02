import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const CONTRIBUTION = 'org.hypercerts.claim.contribution';
const PROFILE = 'app.certified.actor.profile';
const ORGANIZATION = 'app.certified.actor.organization';
const publisherDid = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const secondPublisherDid = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const contributorDid = 'did:plc:cccccccccccccccccccccccc';
const indexedAt = '2025-01-02T03:04:05.000Z';
const contributionUri = `at://${publisherDid}/${CONTRIBUTION}/3jzfcijpj2z2a`;

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

function row({ uri, did, record, indexedAt: rowIndexedAt = indexedAt, sortTimestamp, createdAt: rowCreatedAt }) {
  return {
    uri, did, cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    indexed_at: rowIndexedAt, record,
    ...(sortTimestamp ? { sort_timestamp: sortTimestamp } : {}),
    ...(rowCreatedAt !== undefined ? { created_at: rowCreatedAt } : {}),
  };
}

function runLuaEndpoint({
  endpoint, params = {}, queryResults = [], records = {}, cursorFixtures = {},
  backend = 'postgres', failAt = 0, expectError, assertions = '', printCursor = false,
}) {
  const source = `
local NULL = {}
local RECORDS = ${lua(records)}
local RESULTS = ${lua(queryResults)}
local CURSORS = ${lua(cursorFixtures)}
local calls = {}
json = {
  decode = function(value)
    if value == 'null' then return NULL end
    if RECORDS[value] then return RECORDS[value] end
    if CURSORS[value] then return CURSORS[value] end
    error('unknown JSON fixture')
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
    if ${failAt} == #calls then error('fixture database failure') end
    return RESULTS[#calls] or {}
  end,
}
dofile('lua/endpoints/${endpoint}.lua')
local ok, result = pcall(handle)
${expectError
    ? `assert(not ok, 'expected request to fail')
assert(tostring(result):find(${lua(expectError)}, 1, true), tostring(result))
${assertions}`
    : `assert(ok, tostring(result))
${assertions}
${printCursor ? "print(result.cursor or '')" : ''}`}
`;
  return spawnSync('lua5.4', ['-e', source], { cwd: root, encoding: 'utf8' });
}

test('getContribution returns the exact record and nulls absent publisher sidecars', () => {
  const contributionRecord = {
    $type: CONTRIBUTION,
    role: 'Field researcher',
    contributionDescription: 'Collected and verified river measurements.',
    createdAt: '2025-01-01T00:00:00.000Z',
    contributor: { did: contributorDid },
    extension: { untouched: true },
  };
  const indexed = row({ uri: contributionUri, did: publisherDid, record: 'contribution-record' });
  const result = runLuaEndpoint({
    endpoint: 'getContribution', params: { uri: contributionUri },
    queryResults: [[indexed], [], []], records: { 'contribution-record': contributionRecord },
    assertions: `
assert(result.contribution.uri == ${lua(contributionUri)})
assert(result.contribution.cid == 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
assert(result.contribution.indexedAt == ${lua(indexedAt)})
assert(result.contribution.did == ${lua(publisherDid)})
assert(result.contribution.author.did == ${lua(publisherDid)})
assert(result.contribution.author.did ~= result.contribution.record.contributor.did, 'publisher must not be treated as contributor')
assert(result.contribution.record.role == 'Field researcher')
assert(result.contribution.record.contributionDescription == 'Collected and verified river measurements.')
assert(result.contribution.record.createdAt == '2025-01-01T00:00:00.000Z')
assert(result.contribution.record['$type'] == ${lua(CONTRIBUTION)})
assert(result.contribution.record.contributor.did == ${lua(contributorDid)})
assert(result.contribution.record.extension.untouched == true, 'the complete source record must be preserved')
local recordFields = 0
for _ in pairs(result.contribution.record) do recordFields = recordFields + 1 end
assert(recordFields == 6, 'publisher hydration must not add fields to the source record')
assert(result.contribution.record.author == nil, 'publisher hydration must stay outside the source record')
assert(result.contribution.author.profile == NULL and result.contribution.author.organization == NULL)
assert(#calls == 3)
assert(calls[1].values[1] == ${lua(CONTRIBUTION)} and calls[1].values[2] == ${lua(contributionUri)})
assert(calls[2].values[1] == ${lua(PROFILE)} and calls[2].values[2] == ${lua(publisherDid)})
assert(calls[3].values[1] == ${lua(ORGANIZATION)} and calls[3].values[2] == ${lua(publisherDid)})
`,
  });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('getContribution preserves SQL NULL indexed_at as required indexedAt JSON null', () => {
  const indexed = row({ uri: contributionUri, did: publisherDid, record: 'null-indexed-record', indexedAt: null });
  const result = runLuaEndpoint({
    endpoint: 'getContribution', params: { uri: contributionUri },
    queryResults: [[indexed], [], []],
    records: { 'null-indexed-record': { $type: CONTRIBUTION, createdAt: indexedAt } },
    assertions: `
assert(rawget(result.contribution, 'indexedAt') == NULL, 'SQL NULL indexed_at must remain a present JSON null field')
`,
  });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('getContribution preserves SQL NULL indexed_at on hydrated publisher sidecars', () => {
  const indexed = row({ uri: contributionUri, did: publisherDid, record: 'sidecar-main' });
  const profile = row({
    uri: `at://${publisherDid}/${PROFILE}/self`, did: publisherDid, record: 'null-indexed-profile', indexedAt: null,
  });
  const organization = row({
    uri: `at://${publisherDid}/${ORGANIZATION}/self`, did: publisherDid, record: 'null-indexed-organization', indexedAt: null,
  });
  const result = runLuaEndpoint({
    endpoint: 'getContribution', params: { uri: contributionUri },
    queryResults: [[indexed], [profile], [organization]],
    records: {
      'sidecar-main': { $type: CONTRIBUTION, createdAt: indexedAt },
      'null-indexed-profile': { $type: PROFILE, displayName: 'Publisher', createdAt: indexedAt },
      'null-indexed-organization': { $type: ORGANIZATION, organizationType: ['nonprofit'], createdAt: indexedAt },
    },
    assertions: `
assert(rawget(result.contribution.author.profile, 'indexedAt') == NULL)
assert(rawget(result.contribution.author.organization, 'indexedAt') == NULL)
`,
  });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('getContribution rejects non-exact URIs before querying and distinguishes missing records', () => {
  const invalidParams = [
    { uri: `at://alice.example/${CONTRIBUTION}/3jzfcijpj2z2a` },
    { uri: `at://did:plc:publisher%/${CONTRIBUTION}/3jzfcijpj2z2a` },
    { uri: `at://${publisherDid}/${PROFILE}/self` },
    { uri: [contributionUri, contributionUri] },
    { uri: contributionUri, extra: 'not-accepted' },
    {},
  ];
  for (const params of invalidParams) {
    const result = runLuaEndpoint({
      endpoint: 'getContribution', params, expectError: 'InvalidRequest:',
      assertions: "assert(#calls == 0, 'invalid input must fail before querying')",
    });
    assert.equal(result.status, 0, `${JSON.stringify(params)}\n${result.stderr}${result.stdout}`);
  }

  const broadDid = 'did:plc:%GG';
  const broadUri = `at://${broadDid}/${CONTRIBUTION}/broad-did`;
  const broadLookup = runLuaEndpoint({
    endpoint: 'getContribution', params: { uri: broadUri }, queryResults: [[]],
    expectError: 'RecordNotFound:', assertions: `
assert(#calls == 1 and calls[1].values[2] == ${lua(broadUri)}, 'opaque percent sequences must reach exact lookup unchanged')
`,
  });
  assert.equal(broadLookup.status, 0, `${broadLookup.stderr}${broadLookup.stdout}`);

  const missing = runLuaEndpoint({
    endpoint: 'getContribution', params: { uri: contributionUri }, queryResults: [[]],
    expectError: 'RecordNotFound:', assertions: "assert(#calls == 1, 'missing exact record needs one indexed lookup')",
  });
  assert.equal(missing.status, 0, `${missing.stderr}${missing.stdout}`);
});

test('listContributions applies publisher OR filters, stable paging, and page-only hydration', () => {
  const firstUri = `at://${publisherDid}/${CONTRIBUTION}/first`;
  const lookaheadUri = `at://${secondPublisherDid}/${CONTRIBUTION}/lookahead`;
  const first = row({
    uri: firstUri, did: publisherDid, record: 'first-record',
    sortTimestamp: '2025-03-01T00:00:00.000000Z',
  });
  const lookahead = row({
    uri: lookaheadUri, did: secondPublisherDid, record: 'lookahead-record',
    sortTimestamp: '2025-03-01T00:00:00.000000Z',
  });
  const records = {
    'first-record': { $type: CONTRIBUTION, role: 'First', createdAt: '2025-03-01T00:00:00Z', extension: 'kept' },
    'lookahead-record': { $type: CONTRIBUTION, role: 'Lookahead', createdAt: '2025-03-01T00:00:00Z' },
    'first-profile': { $type: PROFILE, displayName: 'First publisher', createdAt: indexedAt },
    'first-organization': { $type: ORGANIZATION, organizationType: ['nonprofit'], createdAt: indexedAt },
  };
  const profile = row({ uri: `at://${publisherDid}/${PROFILE}/self`, did: publisherDid, record: 'first-profile' });
  const organization = row({ uri: `at://${publisherDid}/${ORGANIZATION}/self`, did: publisherDid, record: 'first-organization' });
  const result = runLuaEndpoint({
    endpoint: 'listContributions',
    params: { authors: [publisherDid, secondPublisherDid], sortDirection: 'asc', limit: '1' },
    queryResults: [[first, lookahead], [profile], [organization]], records, printCursor: true,
    assertions: `
assert(#result.contributions == 1 and result.contributions[1].uri == ${lua(firstUri)})
assert(result.cursor ~= nil, 'the lookahead row must produce a cursor')
assert(result.contributions[1].record.extension == 'kept')
assert(result.contributions[1].author.did == ${lua(publisherDid)})
assert(result.contributions[1].author.profile.record.displayName == 'First publisher')
assert(result.contributions[1].author.organization.record.organizationType[1] == 'nonprofit')
assert(result.activities == nil, 'listing contributions must not expand referring activities')
assert(#calls == 3)
local sql = calls[1].sql
assert(sql:find('contribution.did IN ($2, $3)', 1, true), 'publisher DIDs must use OR semantics')
assert(sql:find("contribution.record::jsonb->>'createdAt'", 1, true), 'sort by the record createdAt')
assert(sql:find('ORDER BY sorted.sort_at ASC, contribution.uri ASC', 1, true), 'URI must break createdAt ties in the same direction')
assert(calls[1].values[1] == ${lua(CONTRIBUTION)})
assert(calls[1].values[2] == ${lua(publisherDid)} and calls[1].values[3] == ${lua(secondPublisherDid)})
assert(calls[1].values[4] == 2, 'fetch one lookahead row')
assert(not table.concat(calls[2].values, '|'):find(${lua(secondPublisherDid)}, 1, true), 'do not hydrate the lookahead publisher profile')
assert(not table.concat(calls[3].values, '|'):find(${lua(secondPublisherDid)}, 1, true), 'do not hydrate the lookahead publisher organization')
`,
  });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  const cursor = JSON.parse(Buffer.from(result.stdout.trim(), 'hex').toString('utf8'));
  assert.deepEqual(cursor, { v: 1, d: 'asc', t: '2025-03-01T00:00:00.000000Z', u: firstUri });
});

test('listContributions retains missing and malformed createdAt records using indexed and row timestamps', () => {
  const validUri = `at://${publisherDid}/${CONTRIBUTION}/valid-created`;
  const missingUri = `at://${publisherDid}/${CONTRIBUTION}/missing-created`;
  const malformedUri = `at://${publisherDid}/${CONTRIBUTION}/malformed-created`;
  const valid = row({ uri: validUri, did: publisherDid, record: 'valid-created-record' });
  const missing = row({
    uri: missingUri, did: publisherDid, record: 'missing-created-record',
    indexedAt: '2025-01-04T00:00:00Z', createdAt: '2025-01-01T00:00:00Z',
  });
  const malformed = row({
    uri: malformedUri, did: publisherDid, record: 'malformed-created-record',
    indexedAt: null, createdAt: '2025-01-03T00:00:00Z',
  });
  const result = runLuaEndpoint({
    endpoint: 'listContributions', params: { limit: '3' },
    queryResults: [[valid, missing, malformed], [], []],
    records: {
      'valid-created-record': { $type: CONTRIBUTION, createdAt: '2025-01-05T00:00:00Z' },
      'missing-created-record': { $type: CONTRIBUTION },
      'malformed-created-record': { $type: CONTRIBUTION, createdAt: 'not-a-datetime' },
    },
    assertions: `
assert(#result.contributions == 3, 'missing or malformed createdAt must not hide indexed records')
assert(result.contributions[1].uri == ${lua(validUri)})
assert(result.contributions[2].uri == ${lua(missingUri)})
assert(result.contributions[3].uri == ${lua(malformedUri)})
local sql = calls[1].sql
assert(sql:find('pg_input_is_valid', 1, true), 'only valid createdAt values may be cast')
assert(sql:find("COALESCE(contribution.indexed_at::timestamptz, contribution.created_at::timestamptz, 'epoch'::timestamptz)", 1, true),
  'invalid and absent record timestamps fall back to indexed_at, then stored row creation')
local filter = sql:match('WHERE (.-) ORDER BY')
assert(filter and not filter:find('createdAt', 1, true), 'timestamp validity must not filter records out')
`,
  });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('listContributions resumes with unchanged author filters and returns null sidecars', () => {
  const previousUri = `at://${publisherDid}/${CONTRIBUTION}/previous`;
  const nextUri = `at://${secondPublisherDid}/${CONTRIBUTION}/next`;
  const cursorValue = { v: 1, d: 'desc', t: '2025-02-01T00:00:00.000000Z', u: previousUri };
  const cursorJson = JSON.stringify(cursorValue);
  const token = Buffer.from(cursorJson).toString('hex');
  const next = row({ uri: nextUri, did: secondPublisherDid, record: 'next-record' });
  const result = runLuaEndpoint({
    endpoint: 'listContributions',
    params: { authors: [publisherDid, secondPublisherDid], sortDirection: 'desc', limit: '2', cursor: token },
    queryResults: [[next], [], []], records: { 'next-record': { $type: CONTRIBUTION, createdAt: indexedAt } },
    cursorFixtures: { [cursorJson]: cursorValue },
    assertions: `
assert(#result.contributions == 1 and result.contributions[1].uri == ${lua(nextUri)})
assert(result.cursor == nil)
assert(result.contributions[1].author.profile == NULL and result.contributions[1].author.organization == NULL)
assert(calls[1].sql:find('(sorted.sort_at, contribution.uri) <', 1, true), 'descending cursor uses the previous tuple')
assert(calls[1].sql:find('ORDER BY sorted.sort_at DESC, contribution.uri DESC', 1, true))
assert(calls[1].sql:find('contribution.did IN ($2, $3)', 1, true), 'the author filter remains active on later pages')
assert(calls[1].values[2] == ${lua(publisherDid)} and calls[1].values[3] == ${lua(secondPublisherDid)})
assert(calls[1].values[4] == ${lua(cursorValue.t)} and calls[1].values[5] == ${lua(previousUri)})
assert(calls[1].values[6] == 3)
`,
  });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('listContributions defaults to 25 descending results and omits a cursor for an empty page', () => {
  const result = runLuaEndpoint({
    endpoint: 'listContributions', queryResults: [[]],
    assertions: `
assert(type(result.contributions) == 'table' and #result.contributions == 0)
assert(result.cursor == nil)
assert(calls[1].values[1] == ${lua(CONTRIBUTION)} and calls[1].values[2] == 26)
assert(calls[1].sql:find('ORDER BY sorted.sort_at DESC, contribution.uri DESC', 1, true))
assert(#calls == 1, 'empty pages must not hydrate actors')
`,
  });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);

  const upperLimit = runLuaEndpoint({
    endpoint: 'listContributions', params: { limit: '100' }, queryResults: [[]],
    assertions: "assert(calls[1].values[2] == 101, 'limit 100 must request one lookahead row')",
  });
  assert.equal(upperLimit.status, 0, `${upperLimit.stderr}${upperLimit.stdout}`);
});

test('listContributions rejects malformed filters and sort-bound cursors before querying', () => {
  const wrongDirection = { v: 1, d: 'asc', t: '2025-01-01T00:00:00Z', u: contributionUri };
  const wrongDirectionJson = JSON.stringify(wrongDirection);
  const invalidParams = [
    { authors: ['alice.example'] },
    { authors: ['did:plc:publisher%'] },
    { authors: Array(101).fill(publisherDid) },
    { authors: [{ did: publisherDid }] },
    { limit: '0' },
    { limit: '101' },
    { limit: ['1', '2'] },
    { sortDirection: 'sideways' },
    { cursor: 'not-hex' },
    { cursor: Buffer.from(wrongDirectionJson).toString('hex'), sortDirection: 'desc' },
    { unknown: 'value' },
  ];
  for (const params of invalidParams) {
    const result = runLuaEndpoint({
      endpoint: 'listContributions', params,
      cursorFixtures: { [wrongDirectionJson]: wrongDirection },
      expectError: 'InvalidRequest:', assertions: "assert(#calls == 0, 'invalid list parameters must fail before querying')",
    });
    assert.equal(result.status, 0, `${JSON.stringify(params)}\n${result.stderr}${result.stdout}`);
  }

  const broadDid = 'did:plc:%GG';
  const broadFilter = runLuaEndpoint({
    endpoint: 'listContributions', params: { authors: [broadDid] }, queryResults: [[]],
    assertions: `assert(#result.contributions == 0 and calls[1].values[2] == ${lua(broadDid)})`,
  });
  assert.equal(broadFilter.status, 0, `${broadFilter.stderr}${broadFilter.stdout}`);
});

test('listContributions accepts opaque percent sequences in cursor DIDs and queries them', () => {
  const broadUri = `at://did:plc:%GG/${CONTRIBUTION}/3jzfcijpj2z2a`;
  const cursor = { v: 1, d: 'asc', t: '2025-01-01T00:00:00Z', u: broadUri };
  const cursorJson = JSON.stringify(cursor);
  const result = runLuaEndpoint({
    endpoint: 'listContributions',
    params: { cursor: Buffer.from(cursorJson).toString('hex'), sortDirection: 'asc' },
    queryResults: [[]], cursorFixtures: { [cursorJson]: cursor },
    assertions: `assert(#result.contributions == 0 and calls[1].values[3] == ${lua(broadUri)})`,
  });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);

  const invalidCursor = { ...cursor, u: `at://did:plc:publisher%/${CONTRIBUTION}/3jzfcijpj2z2a` };
  const invalidJson = JSON.stringify(invalidCursor);
  const invalid = runLuaEndpoint({
    endpoint: 'listContributions',
    params: { cursor: Buffer.from(invalidJson).toString('hex'), sortDirection: 'asc' },
    cursorFixtures: { [invalidJson]: invalidCursor }, expectError: 'InvalidRequest:',
    assertions: "assert(#calls == 0, 'trailing percent must fail before querying')",
  });
  assert.equal(invalid.status, 0, `${invalid.stderr}${invalid.stdout}`);
});

test('listContributions rejects year-zero cursor timestamps before querying', () => {
  const cursor = { v: 1, d: 'asc', t: '0000-01-01T00:00:00Z', u: contributionUri };
  const cursorJson = JSON.stringify(cursor);
  const result = runLuaEndpoint({
    endpoint: 'listContributions',
    params: { cursor: Buffer.from(cursorJson).toString('hex'), sortDirection: 'asc' },
    cursorFixtures: { [cursorJson]: cursor }, expectError: 'InvalidRequest:',
    assertions: "assert(#calls == 0, 'year-zero cursor timestamp must fail before querying')",
  });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('contribution lookup failures are not returned as partial results', () => {
  const indexed = row({ uri: contributionUri, did: publisherDid, record: 'contribution-record' });
  const backendFailure = runLuaEndpoint({
    endpoint: 'getContribution', params: { uri: contributionUri }, backend: 'sqlite',
    expectError: 'ContributionQueryFailed:', assertions: "assert(#calls == 0)",
  });
  assert.equal(backendFailure.status, 0, `${backendFailure.stderr}${backendFailure.stdout}`);

  const hydrationFailure = runLuaEndpoint({
    endpoint: 'getContribution', params: { uri: contributionUri },
    queryResults: [[indexed]], records: { 'contribution-record': { $type: CONTRIBUTION, createdAt: indexedAt } },
    failAt: 2, expectError: 'ContributionQueryFailed:', assertions: "assert(#calls == 2)",
  });
  assert.equal(hydrationFailure.status, 0, `${hydrationFailure.stderr}${hydrationFailure.stdout}`);
});
