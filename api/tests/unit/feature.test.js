import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const FEATURE = 'org.hypercerts.entity.feature';
const PROFILE = 'app.certified.actor.profile';
const ORGANIZATION = 'app.certified.actor.organization';
const FEATURE_DID = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const FEATURE_URI = `at://${FEATURE_DID}/${FEATURE}/forest-zone`;
const PROFILE_URI = `at://${FEATURE_DID}/${PROFILE}/self`;
const ORGANIZATION_URI = `at://${FEATURE_DID}/${ORGANIZATION}/self`;
const FEATURE_RECORD = {
  $type: FEATURE,
  type: 'zone',
  title: 'Wang Chhu floodplain',
  createdAt: '2025-01-02T03:04:05Z',
  locations: [{ uri: 'at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/app.certified.location/location-one', cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
  tags: [{ uri: 'at://did:plc:bbbbbbbbbbbbbbbbbbbbbbbb/org.hypercerts.vocab.tag/wetland', cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab' }],
  sameAs: ['https://example.org/features/wang-chhu'],
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

async function runGetFeature({ params = { uri: FEATURE_URI }, queryResults = null, expectedError = null, expectedCalls = 0, assertions = '' } = {}) {
  const shared = await Promise.all([
    'lua/shared/query.lua',
    'lua/shared/recordIdentifier.lua',
    'lua/shared/recordView.lua',
    'lua/shared/featureProjection.lua',
  ].map((relative) => readFile(new URL(`../../${relative}`, import.meta.url), 'utf8')));
  const endpoint = await readFile(new URL('../../lua/endpoints/getFeature.lua', import.meta.url), 'utf8');
  const databaseRows = queryResults ?? [
    [{ uri: FEATURE_URI, did: FEATURE_DID, cid: 'bafyreicccccccccccccccccccccccccccccccccccccccccccccccccccc', indexed_at: null, record: 'feature-record' }],
    [{ uri: PROFILE_URI, did: FEATURE_DID, cid: 'bafyreidddddddddddddddddddddddddddddddddddddddddddddddddddd', indexed_at: '2025-01-03T00:00:00Z', record: 'profile-record' }],
    [{ uri: ORGANIZATION_URI, did: FEATURE_DID, cid: 'bafyreieeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', indexed_at: '2025-01-04T00:00:00Z', record: 'organization-record' }],
  ];
  const records = {
    'feature-record': FEATURE_RECORD,
    'profile-record': { $type: PROFILE, displayName: 'Feature author', createdAt: '2025-01-03T00:00:00Z' },
    'organization-record': { $type: ORGANIZATION, organizationType: ['community'], createdAt: '2025-01-04T00:00:00Z' },
  };
  const source = `
local NULL = {}
local RESULTS = ${lua(databaseRows)}
local RECORDS = ${lua(records)}
local calls = {}
json = { decode = function(value) if value == 'null' then return NULL end return RECORDS[value] end }
params = ${lua(params)}
toarray = function(value) return value end
db = {
  backend = function() return 'postgres' end,
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    return RESULTS[#calls] or {}
  end,
}
${shared.join('\n\n')}
${endpoint}
local ok, result = pcall(handle)
if ${lua(expectedError)} ~= nil then
  assert(not ok, 'expected request failure')
  assert(tostring(result):find(${lua(expectedError)}, 1, true), tostring(result))
  assert(#calls == ${expectedCalls}, 'unexpected query count')
else
  assert(ok, tostring(result))
  ${assertions}
end
`;
  return spawnSync('lua5.4', ['-e', source], { cwd: root, encoding: 'utf8' });
}

async function runListFeatures(params, queryResults, records = { 'feature-record': FEATURE_RECORD }, assertions = '', expectedError = null, expectedCalls = 0) {
  const shared = await Promise.all([
    'lua/shared/query.lua',
    'lua/shared/recordIdentifier.lua',
    'lua/shared/listQuery.lua',
    'lua/shared/recordView.lua',
    'lua/shared/featureProjection.lua',
  ].map((relative) => readFile(new URL(`../../${relative}`, import.meta.url), 'utf8')));
  const endpoint = await readFile(new URL('../../lua/endpoints/listFeatures.lua', import.meta.url), 'utf8');
  const source = `
local NULL = {}
local RESULTS = ${lua(queryResults)}
local RECORDS = ${lua(records)}
local calls = {}
json = {
  decode = function(value)
    if value == 'null' then return NULL end
    if RECORDS[value] ~= nil then return RECORDS[value] end
    local version = value:match('"v"%s*:%s*(%d+)')
    local direction = value:match('"d"%s*:%s*"([^"]+)"')
    local timestamp = value:match('"t"%s*:%s*"([^"]+)"')
    local uri = value:match('"u"%s*:%s*"([^"]+)"')
    if version then return { v = tonumber(version), d = direction, t = timestamp, u = uri } end
    error('invalid JSON fixture')
  end,
  encode = function(value)
    return '{"d":"' .. value.d .. '","t":"' .. value.t .. '","u":"' .. value.u .. '","v":' .. value.v .. '}'
  end,
}
params = ${lua(params)}
toarray = function(value) return value end
db = {
  backend = function() return 'postgres' end,
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    return RESULTS[#calls] or {}
  end,
}
${shared.join('\n\n')}
${endpoint}
local ok, result = pcall(handle)
if ${lua(expectedError)} ~= nil then
  assert(not ok, 'expected request failure')
  assert(tostring(result):find(${lua(expectedError)}, 1, true), tostring(result))
  assert(#calls == ${expectedCalls}, 'unexpected query count')
else
  assert(ok, tostring(result))
  ${assertions}
end
`;
  return spawnSync('lua5.4', ['-e', source], { cwd: root, encoding: 'utf8' });
}

test('getFeature returns the exact indexed feature with nullable metadata and hydrated author only', async () => {
  const result = await runGetFeature({ assertions: `
assert(result.feature['$type'] == 'org.hypercerts.entity.defs#featureView')
assert(result.feature.uri == '${FEATURE_URI}' and result.feature.did == '${FEATURE_DID}')
assert(result.feature.cid == 'bafyreicccccccccccccccccccccccccccccccccccccccccccccccccccc')
assert(result.feature.indexedAt == NULL, 'missing indexedAt must be JSON null')
assert(result.feature.author.did == '${FEATURE_DID}')
assert(result.feature.author.profile.uri == '${PROFILE_URI}')
assert(result.feature.author.profile.record.displayName == 'Feature author')
assert(result.feature.author.organization.uri == '${ORGANIZATION_URI}')
assert(result.feature.author.organization.record.organizationType[1] == 'community')
assert(result.feature.record.title == 'Wang Chhu floodplain')
assert(result.feature.record.locations[1].uri == '${FEATURE_RECORD.locations[0].uri}')
assert(result.feature.record.tags[1].uri == '${FEATURE_RECORD.tags[0].uri}')
assert(result.feature.record.sameAs[1] == '${FEATURE_RECORD.sameAs[0]}')
assert(result.feature.location == nil and result.feature.tags == nil and result.feature.sameAs == nil, 'feature references must remain unexpanded')
assert(#calls == 3, 'lookup and author hydration should use three queries')
assert(calls[1].sql:find('WHERE collection = $1 AND uri = $2 LIMIT 1', 1, true))
assert(calls[1].values[1] == '${FEATURE}' and calls[1].values[2] == '${FEATURE_URI}')
` });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('getFeature distinguishes invalid feature URIs from unindexed records', async () => {
  for (const uri of [
    'at://alice.example/org.hypercerts.entity.feature/forest-zone',
    'at://did:web:example.org%GG/org.hypercerts.entity.feature/forest-zone',
    `at://${FEATURE_DID}/app.certified.location/location-one`,
  ]) {
    const invalid = await runGetFeature({ params: { uri }, queryResults: [], expectedError: 'InvalidRequest:', expectedCalls: 0 });
    assert.equal(invalid.status, 0, `${invalid.stderr}${invalid.stdout}`);
  }
  const missing = await runGetFeature({ params: { uri: FEATURE_URI }, queryResults: [[]], expectedError: 'RecordNotFound:', expectedCalls: 1 });
  assert.equal(missing.status, 0, `${missing.stderr}${missing.stdout}`);
});

test('listFeatures combines exact array filters with organization-record absence and stable default paging', async () => {
  const row = {
    uri: FEATURE_URI, did: FEATURE_DID,
    cid: 'bafyreicccccccccccccccccccccccccccccccccccccccccccccccccccc',
    indexed_at: '2025-01-02T03:04:05Z', record: 'feature-record',
  };
  const result = await runListFeatures({
    authors: [FEATURE_DID, FEATURE_DID],
    hasOrganizationRecord: 'false',
    types: ['zone', 'future-kind', 'zone'],
  }, [[row], [], []], undefined, `
assert(#result.features == 1 and result.cursor == nil)
local feature = result.features[1]
assert(feature['$type'] == 'org.hypercerts.entity.defs#featureView')
assert(feature.uri == '${FEATURE_URI}' and feature.record.title == 'Wang Chhu floodplain')
assert(feature.author.profile == NULL and feature.author.organization == NULL, 'organization filtering must not hide profile-less authors')
local sql = calls[1].sql
assert(sql:find('feature.did IN ($2)', 1, true), 'authors use an OR filter with one duplicate removed')
assert(sql:find("feature.record::jsonb ->> 'type' IN ($3, $4)", 1, true), 'types use exact OR matching')
assert(sql:find("NOT EXISTS (SELECT 1 FROM happyview_records AS organization", 1, true), 'false requires organization-record absence')
assert(sql:find("organization.collection = 'app.certified.actor.organization'", 1, true))
assert(sql:find("organization.rkey = 'self'", 1, true) and sql:find('organization.did = feature.did', 1, true))
assert(not sql:find('app.certified.actor.profile', 1, true), 'organization filtering must not depend on profile presence')
assert(sql:find('ORDER BY sorted.sort_at DESC, feature.uri DESC', 1, true), 'default order is descending by createdAt then URI')
assert(calls[1].values[1] == '${FEATURE}' and calls[1].values[2] == '${FEATURE_DID}')
assert(calls[1].values[3] == 'zone' and calls[1].values[4] == 'future-kind', 'unknown open feature types remain exact filters')
assert(calls[1].values[5] == 26, 'the default page size is 25 plus one lookahead row')
`);
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('listFeatures returns a createdAt-and-URI cursor and hydrates only the returned page', async () => {
  const lookaheadDid = 'did:web:lookahead.example';
  const lookaheadUri = `at://${lookaheadDid}/${FEATURE}/later-zone`;
  const pageRow = {
    uri: FEATURE_URI, did: FEATURE_DID,
    cid: 'bafyreicccccccccccccccccccccccccccccccccccccccccccccccccccc',
    indexed_at: '2025-01-05T00:00:00Z', sort_timestamp: '2025-01-02T03:04:05.123456Z', record: 'page-feature',
  };
  const lookaheadRow = {
    uri: lookaheadUri, did: lookaheadDid,
    cid: 'bafyreidddddddddddddddddddddddddddddddddddddddddddddddddddd',
    indexed_at: '2025-01-06T00:00:00Z', sort_timestamp: '2025-01-03T00:00:00.000000Z', record: 'lookahead-feature',
  };
  const profileRow = {
    uri: PROFILE_URI, did: FEATURE_DID,
    cid: 'bafyreieeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    indexed_at: '2025-01-07T00:00:00Z', record: 'page-profile',
  };
  const result = await runListFeatures({ sortDirection: 'asc', limit: '1' },
    [[pageRow, lookaheadRow], [profileRow], []], {
      'page-feature': FEATURE_RECORD,
      'lookahead-feature': FEATURE_RECORD,
      'page-profile': { $type: PROFILE, displayName: 'Page author', createdAt: '2025-01-07T00:00:00Z' },
    }, `
assert(#result.features == 1 and result.features[1].uri == '${FEATURE_URI}')
assert(result.features[1].author.profile.record.displayName == 'Page author')
assert(type(result.cursor) == 'string', 'a lookahead row must produce a cursor')
local cursorJson = result.cursor:gsub('..', function(pair) return string.char(tonumber(pair, 16)) end)
local cursor = json.decode(cursorJson)
assert(cursor.v == 1 and cursor.d == 'asc')
assert(cursor.t == '2025-01-02T03:04:05.123456Z' and cursor.u == '${FEATURE_URI}')
assert(calls[1].sql:find('ORDER BY sorted.sort_at ASC, feature.uri ASC', 1, true))
assert(calls[1].values[1] == '${FEATURE}' and calls[1].values[2] == 2)
assert(calls[2].values[1] == '${PROFILE}' and calls[2].values[2] == '${FEATURE_DID}')
assert(#calls[2].values == 2, 'the lookahead author must not be hydrated')
assert(#calls == 3)
`);
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);

  const incomingCursor = Buffer.from(JSON.stringify({
    v: 1, d: 'asc', t: '2025-01-02T03:04:05.123456Z', u: FEATURE_URI,
  })).toString('hex');
  const nextUri = `at://${FEATURE_DID}/${FEATURE}/next-zone`;
  const nextPage = await runListFeatures({ sortDirection: 'asc', limit: '1', cursor: incomingCursor }, [[{
    uri: nextUri, did: FEATURE_DID,
    cid: 'bafyreiffffffffffffffffffffffffffffffffffffffffffffffffffff',
    indexed_at: '2025-01-08T00:00:00Z', sort_timestamp: '2025-01-04T00:00:00.000000Z', record: 'feature-record',
  }], [], []], undefined, `
assert(#result.features == 1 and result.features[1].uri == '${nextUri}')
assert(result.cursor == nil, 'the final page must omit its cursor')
assert(calls[1].sql:find('(sorted.sort_at, feature.uri) > (($2)::timestamptz, $3)', 1, true))
assert(calls[1].values[2] == '2025-01-02T03:04:05.123456Z')
assert(calls[1].values[3] == '${FEATURE_URI}' and calls[1].values[4] == 2)
`);
  assert.equal(nextPage.status, 0, `${nextPage.stderr}${nextPage.stdout}`);
});

test('listFeatures applies the positive organization-record filter without requiring a profile', async () => {
  const result = await runListFeatures({ hasOrganizationRecord: 'true' }, [[]], undefined, `
assert(#result.features == 0 and result.cursor == nil and #calls == 1)
assert(calls[1].sql:find('EXISTS (SELECT 1 FROM happyview_records AS organization', 1, true))
assert(calls[1].sql:find("organization.rkey = 'self'", 1, true))
assert(calls[1].sql:find('organization.did = feature.did', 1, true))
assert(not calls[1].sql:find('app.certified.actor.profile', 1, true))
`);
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});

test('listFeatures rejects unknown, malformed, repeated, and out-of-range inputs before querying', async () => {
  const wrongDirectionCursor = Buffer.from(JSON.stringify({
    v: 1, d: 'asc', t: '2025-01-02T03:04:05Z', u: FEATURE_URI,
  })).toString('hex');
  const malformedAuthorityCursor = Buffer.from(JSON.stringify({
    v: 1, d: 'desc', t: '2025-01-02T03:04:05Z',
    u: 'at://did:web:example.org%GG/org.hypercerts.entity.feature/forest-zone',
  })).toString('hex');
  const yearZeroCursor = Buffer.from(JSON.stringify({
    v: 1, d: 'desc', t: '0000-01-01T00:00:00Z', u: FEATURE_URI,
  })).toString('hex');
  const invalidRequests = [
    { unknown: 'value' },
    { authors: ['alice.example'] },
    { authors: ['did:plc:aaaaaaaaaaaaaaaaaaaaaaaa:'] },
    { authors: ['did:web:example.org%GG'] },
    { authors: [42] },
    { authors: Array(101).fill(FEATURE_DID) },
    { types: ['t'.repeat(65)] },
    { types: [42] },
    { hasOrganizationRecord: 'sometimes' },
    { hasOrganizationRecord: ['true', 'false'] },
    { limit: '0' },
    { limit: '101' },
    { limit: ['1', '2'] },
    { sortDirection: 'sideways' },
    { cursor: 'not-a-cursor!' },
    { cursor: 123 },
    { sortDirection: 'desc', cursor: malformedAuthorityCursor },
    { sortDirection: 'desc', cursor: yearZeroCursor },
    { sortDirection: 'desc', cursor: wrongDirectionCursor },
  ];
  for (const params of invalidRequests) {
    const result = await runListFeatures(params, [], undefined, '', 'InvalidRequest:', 0);
    assert.equal(result.status, 0, `${JSON.stringify(params)}\n${result.stderr}${result.stdout}`);
  }
});
