import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const definitionCollection = 'app.certified.badge.definition';
const awardCollection = 'app.certified.badge.award';
const responseCollection = 'app.certified.badge.response';
const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const issuer = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa';
const indexedAt = '2025-02-01T00:00:01.000Z';

function lua(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `{${value.map(lua).join(',')}}`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `[${JSON.stringify(key)}]=${lua(item)}`).join(',')}}`;
  }
  throw new TypeError(`Cannot encode ${typeof value} as a Lua fixture`);
}

async function handlerSource(endpoint) {
  return readFile(`${root}/lua/endpoints/${endpoint}.lua`, 'utf8');
}

function runLua(source, { params, queryResults = [], recordValues = {}, assertions = '', expectedError = '' }) {
  const records = {
    ...recordValues,
    ...Object.fromEntries(queryResults.flat().map(({ record, record_json }) => [record, record_json])),
  };
  const rows = queryResults.map((result) => result.map((row) => Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== 'record_json'),
  )));
  const luaSource = `
local RECORDS = ${lua(records)}
local RESULTS = ${lua(rows)}
local EXPECTED_ERROR = ${lua(expectedError)}
local NULL_VALUE = {}
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
  backend = function() return 'postgres' end,
  raw = function(sql, values)
    calls[#calls + 1] = { sql = sql, values = values }
    return RESULTS[#calls] or {}
  end,
}
${source}
local ok, result = pcall(handle)
if EXPECTED_ERROR ~= '' then
  assert(not ok, 'expected handler failure')
  assert(tostring(result):find(EXPECTED_ERROR, 1, true), tostring(result))
else
  assert(ok, tostring(result))
end
${assertions}
`;
  const result = spawnSync('lua5.4', ['-e', luaSource], { cwd: root, encoding: 'utf8' });
  const line = result.stderr.match(/\(command line\):(\d+):/);
  const failingLine = line ? luaSource.split('\n')[Number(line[1]) - 1] : '';
  assert.equal(result.status, 0, `${result.stderr}${failingLine ? `Lua: ${failingLine}\n` : ''}${result.stdout}`);
}

function definitionRow(rkey, record, sortTimestamp = '2025-02-01T00:00:00.000000Z') {
  return {
    uri: `at://${issuer}/${definitionCollection}/${rkey}`,
    did: issuer,
    cid: `bafy-${rkey}`,
    indexed_at: indexedAt,
    record: `definition-${rkey}`,
    record_json: { $type: definitionCollection, ...record },
    sort_timestamp: sortTimestamp,
  };
}

function sidecarRow(collection, did, label, record) {
  return {
    uri: `at://${did}/${collection}/self`,
    did,
    cid: `bafy-${label}`,
    indexed_at: indexedAt,
    record: label,
    record_json: { $type: collection, ...record },
  };
}

// SQL NULL values decode to nil in Lua, so omit those fields in the row fixtures.
function sqlNullColumns(row, ...columns) {
  const result = { ...row };
  for (const column of columns) delete result[column];
  return result;
}

test('badge record-view indexedAt fields remain required and allow null in their Lexicons', async () => {
  const views = [
    ['searchBadgeDefinitions', 'badgeDefinitionView'],
    ['getBadgeAward', 'badgeAwardView'],
    ['getBadgeAward', 'badgeDefinitionRecordView'],
    ['getBadgeAward', 'badgeResponseRecordView'],
    ['getBadgeResponse', 'badgeResponseView'],
  ];
  const documents = new Map();
  for (const [endpoint, name] of views) {
    let document = documents.get(endpoint);
    if (!document) {
      document = JSON.parse(await readFile(`${root}/lexicons/app.certified.badge.${endpoint}.json`, 'utf8'));
      documents.set(endpoint, document);
    }
    const view = document.defs[name];
    assert.ok(view.required.includes('indexedAt'), `${name} keeps indexedAt required`);
    assert.ok(view.nullable?.includes('indexedAt'), `${name} declares indexedAt nullable`);
  }
});

test('searchBadgeDefinitions searches literally and case-insensitively, filters, paginates, and hydrates authors', async () => {
  const definition = definitionRow('forest', {
    title: '100% Golden certification',
    description: 'A verified watershed',
    badgeType: 'certification',
    createdAt: '2025-02-01T00:00:00Z',
  });
  const lookahead = definitionRow('lookahead', {
    title: 'Another badge',
    badgeType: 'certification',
    createdAt: '2025-02-02T00:00:00Z',
  }, '2025-02-02T00:00:00.000000Z');
  const profile = sidecarRow(profileCollection, issuer, 'profile', { displayName: 'Forest Alliance' });
  const organization = sidecarRow(organizationCollection, issuer, 'organization', { visibility: 'public' });

  runLua(await handlerSource('searchBadgeDefinitions'), {
    params: {
      search: '  100% GOLD  ', authors: [issuer], badgeTypes: ['certification'],
      sortDirection: 'asc', limit: '1',
    },
    queryResults: [[definition, lookahead], [profile], [organization]],
    assertions: `
assert(#result.badgeDefinitions == 1)
assert(result.badgeDefinitions[1].uri == '${definition.uri}')
assert(result.badgeDefinitions[1].indexedAt == '${indexedAt}', 'non-null indexedAt remains a string')
assert(result.badgeDefinitions[1].record.title == '100% Golden certification')
assert(result.badgeDefinitions[1].author.profile.record.displayName == 'Forest Alliance')
assert(result.badgeDefinitions[1].author.profile.indexedAt == '${indexedAt}')
assert(result.badgeDefinitions[1].author.organization.record.visibility == 'public')
assert(result.badgeDefinitions[1].author.organization.indexedAt == '${indexedAt}')
local cursor = json.decode(result.cursor)
assert(cursor.v == 1 and cursor.d == 'asc' and cursor.t == '${definition.sort_timestamp}' and cursor.u == '${definition.uri}')
local sql = calls[1].sql
assert(sql:find("strpos(lower(COALESCE(record::jsonb->>'title'", 1, true))
assert(sql:find("record::jsonb->>'description'", 1, true))
assert(sql:find(' OR ', 1, true), 'title and description are alternatives')
assert(not sql:find('ILIKE', 1, true), 'percent is treated literally')
local function has(values, expected)
  for _, value in ipairs(values) do if value == expected then return true end end
  return false
end
assert(has(calls[1].values, '100% GOLD'))
assert(has(calls[1].values, '${issuer}') and has(calls[1].values, 'certification'))
assert(has(calls[1].values, 2), 'the query fetches one lookahead row')
assert(sql:find('ORDER BY sorted.sort_at ASC, uri ASC', 1, true))
assert(calls[2].values[1] == '${profileCollection}' and calls[3].values[1] == '${organizationCollection}')
`,
  });
});

test('getBadgeAward resolves a record subject recipient and projects only the exact award-version response', async () => {
  const recipient = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
  const badgeUri = `at://${issuer}/${definitionCollection}/forest`;
  const awardUri = `at://${issuer}/${awardCollection}/award-1`;
  const responseUri = `at://${recipient}/${responseCollection}/response-1`;
  const awardCid = 'bafy-award-v1';
  const awardRow = {
    uri: awardUri, did: issuer, cid: awardCid, indexed_at: indexedAt, record: 'award-record',
    record_json: {
      $type: awardCollection,
      badge: { uri: badgeUri, cid: 'bafy-definition-v1' },
      subject: { uri: `at://${recipient}/org.hypercerts.claim.activity/activity-1`, cid: 'bafy-subject' },
      createdAt: '2025-01-01T00:00:00Z',
    },
    badge_uri: badgeUri, badge_cid: 'bafy-definition-v1', badge_indexed_at: indexedAt,
    badge_did: issuer, badge_record: 'pinned-definition-record',
    recipient_response_uri: responseUri, recipient_response_cid: 'bafy-response-v1',
    recipient_response_indexed_at: '2025-02-02T00:00:00.000Z', recipient_response_did: recipient,
    recipient_response_record: 'recipient-response-record',
  };
  const profile = sidecarRow(profileCollection, issuer, 'issuer-profile', { displayName: 'Issuer' });
  const response = {
    $type: responseCollection,
    badgeAward: { uri: awardUri, cid: awardCid },
    response: 'accepted',
    createdAt: '2020-01-01T00:00:00Z',
  };

  runLua(await handlerSource('getBadgeAward'), {
    params: { uri: awardUri },
    queryResults: [[awardRow], [profile], []],
    recordValues: {
      'pinned-definition-record': { $type: definitionCollection, title: 'Forest Badge', badgeType: 'certification' },
      'recipient-response-record': response,
    },
    assertions: `
assert(result.badgeAward.uri == '${awardUri}' and result.badgeAward.cid == '${awardCid}')
assert(result.badgeAward.indexedAt == '${indexedAt}')
assert(result.badgeAward.badge.indexedAt == '${indexedAt}')
assert(result.badgeAward.recipientResponse.indexedAt == '2025-02-02T00:00:00.000Z')
assert(result.badgeAward.record.subject.uri == 'at://${recipient}/org.hypercerts.claim.activity/activity-1')
assert(result.badgeAward.badge.uri == '${badgeUri}' and result.badgeAward.badge.cid == 'bafy-definition-v1')
assert(result.badgeAward.badge.record.title == 'Forest Badge' and result.badgeAward.badge.author == nil)
assert(result.badgeAward.responseStatus == 'accepted')
assert(result.badgeAward.recipientResponse.uri == '${responseUri}')
assert(result.badgeAward.recipientResponse.author == nil)
assert(result.badgeAward.author.profile.record.displayName == 'Issuer')
local sql = calls[1].sql
assert(sql:find("badge.cid = award.record::jsonb->'badge'->>'cid'", 1, true))
assert(sql:find("response.did = CASE WHEN jsonb_typeof(award.record::jsonb->'subject') = 'string'", 1, true))
assert(sql:find("split_part(award.record::jsonb->'subject'->>'uri', '/', 3)", 1, true))
assert(sql:find("response.record::jsonb->'badgeAward'->>'uri' = award.uri", 1, true))
assert(sql:find("response.record::jsonb->'badgeAward'->>'cid' = award.cid", 1, true))
local responseFilter = sql:find("response.record::jsonb->>'response' IN ('accepted', 'rejected')", 1, true)
local responseOrder = sql:find('ORDER BY response.indexed_at DESC NULLS LAST, response.uri DESC', 1, true)
assert(responseFilter and responseOrder and responseFilter < responseOrder,
  'filter unknown open values before selecting the latest recognized response')
assert(not sql:find("response.record::jsonb->>'createdAt'", 1, true), 'publisher-declared time does not determine the latest response')
`,
  });

  runLua(await handlerSource('getBadgeAward'), {
    params: { uri: awardUri },
    queryResults: [[]],
    expectedError: 'RecordNotFound: badge award is not indexed',
    assertions: 'assert(#calls == 1)',
  });
});

test('listBadgeAwards combines filters, keeps repeated awards, and returns recipient status with keyset pagination', async () => {
  const secondIssuer = 'did:plc:cccccccccccccccccccccccc';
  const recipient = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
  const recordOwner = 'did:plc:dddddddddddddddddddddddd';
  const badgeUri = `at://${issuer}/${definitionCollection}/forest`;
  const subjectRecord = `at://${recordOwner}/org.hypercerts.claim.activity/claim-1`;
  const awardUri = (rkey) => `at://${issuer}/${awardCollection}/${rkey}`;
  const awardRow = (uri, did, name, subject, createdAt, response = null) => ({
    uri, did, cid: `bafy-${name}`, indexed_at: indexedAt, record: name,
    record_json: { $type: awardCollection, badge: { uri: badgeUri, cid: 'bafy-definition-v1' }, subject, createdAt },
    badge_uri: badgeUri, badge_cid: 'bafy-definition-v1', badge_indexed_at: indexedAt,
    badge_did: issuer, badge_record: 'badge-record',
    ...(response ? {
      recipient_response_uri: response.uri,
      recipient_response_cid: response.cid,
      recipient_response_indexed_at: indexedAt,
      recipient_response_did: response.did,
      recipient_response_record: response.record,
    } : {}),
    sort_timestamp: createdAt.replace('Z', '.000000Z'),
  });
  const rows = [
    awardRow(awardUri('actor-1'), issuer, 'actor-one', recipient, '2025-01-01T00:00:00Z', {
      uri: `at://${recipient}/${responseCollection}/actor-1`, cid: 'bafy-response-1', did: recipient, record: 'response-1',
    }),
    awardRow(`at://${secondIssuer}/${awardCollection}/actor-2`, secondIssuer, 'actor-two', recipient, '2025-01-02T00:00:00Z'),
    awardRow(awardUri('record-1'), issuer, 'record-one', { uri: subjectRecord, cid: 'bafy-subject' }, '2025-01-03T00:00:00Z', {
      uri: `at://${recordOwner}/${responseCollection}/record-1`, cid: 'bafy-response-record', did: recordOwner, record: 'response-record',
    }),
    awardRow(awardUri('lookahead'), issuer, 'lookahead', recipient, '2025-01-04T00:00:00Z'),
  ];
  const profiles = [
    sidecarRow(profileCollection, issuer, 'issuer-profile', { displayName: 'Issuer One' }),
    sidecarRow(profileCollection, secondIssuer, 'second-issuer-profile', { displayName: 'Issuer Two' }),
  ];
  const responseRecord = (uri, cid, response) => ({
    $type: responseCollection,
    badgeAward: { uri, cid },
    response,
    createdAt: '2020-01-01T00:00:00Z',
  });

  runLua(await handlerSource('listBadgeAwards'), {
    params: {
      authors: [issuer, secondIssuer], badgeUris: [badgeUri], badgeTypes: ['certification'],
      subjects: [recipient, subjectRecord], responses: ['accepted', 'unanswered'], sortDirection: 'asc', limit: '3',
    },
    queryResults: [rows, profiles, []],
    recordValues: {
      'badge-record': { $type: definitionCollection, title: 'Forest Badge', badgeType: 'certification' },
      'response-1': responseRecord(awardUri('actor-1'), 'bafy-actor-one', 'accepted'),
      'response-record': responseRecord(awardUri('record-1'), 'bafy-record-one', 'accepted'),
    },
    assertions: `
assert(#result.badgeAwards == 3 and result.cursor ~= nil)
assert(result.badgeAwards[1].uri == '${awardUri('actor-1')}')
assert(result.badgeAwards[2].uri == 'at://${secondIssuer}/${awardCollection}/actor-2')
assert(result.badgeAwards[1].uri ~= result.badgeAwards[2].uri, 'awards sharing a badge and subject stay distinct')
assert(result.badgeAwards[1].indexedAt == '${indexedAt}')
assert(result.badgeAwards[1].badge.indexedAt == '${indexedAt}')
assert(result.badgeAwards[1].recipientResponse.indexedAt == '${indexedAt}')
assert(result.badgeAwards[1].responseStatus == 'accepted')
assert(result.badgeAwards[2].responseStatus == 'unanswered' and result.badgeAwards[2].recipientResponse == NULL_VALUE)
assert(result.badgeAwards[3].record.subject.uri == '${subjectRecord}')
assert(result.badgeAwards[3].responseStatus == 'accepted' and result.badgeAwards[3].recipientResponse.did == '${recordOwner}')
assert(result.badgeAwards[1].author.profile.record.displayName == 'Issuer One')
local cursor = json.decode(result.cursor)
assert(cursor.v == 1 and cursor.d == 'asc' and cursor.u == '${rows[2].uri}')
local sql = calls[1].sql
assert(sql:find('award.did IN', 1, true))
assert(sql:find("award.record::jsonb->'badge'->>'uri' IN", 1, true))
assert(sql:find("badge.record::jsonb->>'badgeType' IN", 1, true))
assert(sql:find("badge.cid = award.record::jsonb->'badge'->>'cid'", 1, true))
assert(sql:find("jsonb_typeof(award.record::jsonb->'subject') = 'string'", 1, true))
assert(sql:find("jsonb_typeof(award.record::jsonb->'subject') = 'object'", 1, true))
assert(sql:find("award.record::jsonb->'subject'->>'uri' IN", 1, true))
assert(sql:find("COALESCE(recipient_response.record::jsonb->>'response', 'unanswered') IN", 1, true))
local responseFilter = sql:find("response.record::jsonb->>'response' IN ('accepted', 'rejected')", 1, true)
local responseOrder = sql:find('ORDER BY response.indexed_at DESC NULLS LAST, response.uri DESC', 1, true)
assert(responseFilter and responseOrder and responseFilter < responseOrder,
  'filter unknown open values before applying response status filters')
assert(sql:find('ORDER BY sorted.sort_at ASC, award.uri ASC', 1, true))
assert(calls[1].values[#calls[1].values] == 4, 'the query fetches one lookahead award')
local function has(values, expected)
  for _, value in ipairs(values) do if value == expected then return true end end
  return false
end
for _, value in ipairs({ '${issuer}', '${secondIssuer}', '${badgeUri}', 'certification', '${recipient}', '${subjectRecord}', 'accepted', 'unanswered' }) do
  assert(has(calls[1].values, value), 'filter value is bound: ' .. value)
end
`,
  });

  const unavailableVersion = {
    uri: awardUri('older-definition'), did: issuer, cid: 'bafy-award-old', indexed_at: indexedAt,
    record: 'award-with-unavailable-definition',
    record_json: {
      $type: awardCollection,
      badge: { uri: badgeUri, cid: 'bafy-definition-old' },
      subject: recipient,
      createdAt: '2024-12-01T00:00:00Z',
    },
    sort_timestamp: '2024-12-01T00:00:00.000000Z',
  };
  runLua(await handlerSource('listBadgeAwards'), {
    params: { responses: ['unanswered'] },
    queryResults: [[unavailableVersion]],
    assertions: `
assert(#result.badgeAwards == 1)
assert(result.badgeAwards[1].badge == NULL_VALUE)
assert(result.badgeAwards[1].responseStatus == 'unanswered' and result.badgeAwards[1].recipientResponse == NULL_VALUE)
assert(calls[1].sql:find("response.record::jsonb->>'response' IN ('accepted', 'rejected')", 1, true))
assert(calls[1].sql:find("COALESCE(recipient_response.record::jsonb->>'response', 'unanswered') IN", 1, true),
  'unanswered filtering includes awards with no recognized response')
`,
  });
});

test('listBadgeAwards rejects invalid subject identifiers before querying', async () => {
  runLua(await handlerSource('listBadgeAwards'), {
    params: { subjects: ['did:plc:bbbbbbbbbbbbbbbbbbbbbbbb', 'recipient.example'] },
    expectedError: 'InvalidRequest: subjects[2]',
    assertions: 'assert(#calls == 0)',
  });
});

test('listBadgeAwards requires valid record subject collection NSIDs without changing DID and AT-URI matching', async () => {
  const recipient = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
  const subjectUri = `at://${recipient}/org.hypercerts.claim.activity/activity-1`;

  runLua(await handlerSource('listBadgeAwards'), {
    params: { subjects: [recipient, subjectUri] },
    queryResults: [[]],
    assertions: `
assert(#result.badgeAwards == 0)
local sql = calls[1].sql
assert(sql:find("award.record::jsonb->>'subject' IN", 1, true))
assert(sql:find("award.record::jsonb->'subject'->>'uri' IN", 1, true))
local function has(values, expected)
  for _, value in ipairs(values) do if value == expected then return true end end
  return false
end
assert(has(calls[1].values, '${recipient}') and has(calls[1].values, '${subjectUri}'))
`,
  });

  runLua(await handlerSource('listBadgeAwards'), {
    params: { subjects: [recipient, `at://${recipient}/not an nsid/activity-1`] },
    queryResults: [[]],
    expectedError: 'InvalidRequest: subjects[2]',
    assertions: 'assert(#calls == 0)',
  });
});

test('getBadgeResponse hydrates its publisher but leaves the referenced award raw', async () => {
  const publisher = 'did:plc:eeeeeeeeeeeeeeeeeeeeeeee';
  const awardUri = `at://${issuer}/${awardCollection}/award-1`;
  const responseUri = `at://${publisher}/${responseCollection}/response-1`;
  const row = {
    uri: responseUri, did: publisher, cid: 'bafy-response-v1', indexed_at: indexedAt,
    record: 'response-record',
    record_json: {
      $type: responseCollection,
      badgeAward: { uri: awardUri, cid: 'bafy-award-v1' },
      response: 'deferred', weight: 'low', createdAt: '2025-02-01T00:00:00Z',
    },
  };
  const profile = sidecarRow(profileCollection, publisher, 'response-publisher-profile', { displayName: 'Independent Reviewer' });

  runLua(await handlerSource('getBadgeResponse'), {
    params: { uri: responseUri },
    queryResults: [[row], [profile], []],
    assertions: `
assert(result.badgeResponse.uri == '${responseUri}' and result.badgeResponse.cid == 'bafy-response-v1')
assert(result.badgeResponse.indexedAt == '${indexedAt}')
assert(result.badgeResponse.author.profile.record.displayName == 'Independent Reviewer')
assert(result.badgeResponse.author.organization == NULL_VALUE)
assert(result.badgeResponse.record.response == 'deferred' and result.badgeResponse.record.weight == 'low',
  'open response values remain readable on raw response queries')
assert(result.badgeResponse.record.badgeAward.uri == '${awardUri}')
assert(result.badgeResponse.record.badgeAward.cid == 'bafy-award-v1')
assert(result.badgeResponse.badgeAward == nil, 'the award is not expanded')
assert(calls[1].values[1] == '${responseCollection}' and calls[1].values[2] == '${responseUri}')
`,
  });
});

test('listBadgeResponses preserves non-recipient response history and filters by award URI only', async () => {
  const nonRecipient = 'did:plc:eeeeeeeeeeeeeeeeeeeeeeee';
  const awardUri = `at://${issuer}/${awardCollection}/award-1`;
  const row = (rkey, cid, createdAt, sortTimestamp) => ({
    uri: `at://${nonRecipient}/${responseCollection}/${rkey}`,
    did: nonRecipient,
    cid: `bafy-response-${rkey}`,
    indexed_at: indexedAt,
    record: `raw-${rkey}`,
    record_json: {
      $type: responseCollection,
      badgeAward: { uri: awardUri, cid },
      response: 'accepted',
      createdAt,
    },
    sort_timestamp: sortTimestamp,
  });
  const newest = row('response-z', 'bafy-award-v1', '2025-02-03T00:00:00Z', '2025-02-03T00:00:00.000000Z');
  const olderVersion = row('response-a', 'bafy-award-old', '2025-02-03T00:00:00Z', '2025-02-03T00:00:00.000000Z');
  const lookahead = row('older', 'bafy-award-v1', '2025-02-02T00:00:00Z', '2025-02-02T00:00:00.000000Z');
  const profile = sidecarRow(profileCollection, nonRecipient, 'reviewer-profile', { displayName: 'Reviewer' });

  runLua(await handlerSource('listBadgeResponses'), {
    params: { badgeAward: awardUri, limit: '2' },
    queryResults: [[newest, olderVersion, lookahead], [profile], []],
    assertions: `
assert(#result.badgeResponses == 2 and result.cursor ~= nil)
assert(result.badgeResponses[1].uri == '${newest.uri}')
assert(result.badgeResponses[1].indexedAt == '${indexedAt}')
assert(result.badgeResponses[2].uri == '${olderVersion.uri}')
assert(result.badgeResponses[1].record.badgeAward.cid == 'bafy-award-v1')
assert(result.badgeResponses[2].record.badgeAward.cid == 'bafy-award-old', 'raw history retains older award versions')
assert(result.badgeResponses[1].author.profile.record.displayName == 'Reviewer')
local cursor = json.decode(result.cursor)
assert(cursor.d == 'desc' and cursor.t == '${olderVersion.sort_timestamp}' and cursor.u == '${olderVersion.uri}')
local sql = calls[1].sql
assert(sql:find("response.record::jsonb->'badgeAward'->>'uri' =", 1, true))
assert(not sql:find("response.record::jsonb->'badgeAward'->>'cid'", 1, true), 'raw history filtering ignores the award CID')
assert(sql:find('ORDER BY sorted.sort_at DESC, response.uri DESC', 1, true))
assert(not sql:find('JOIN happyview_records AS award', 1, true), 'listing does not expand referenced awards')
assert(calls[1].values[2] == '${awardUri}' and calls[1].values[#calls[1].values] == 3)
`,
  });
});

test('badge handlers preserve SQL NULL indexedAt as explicit JSON null', async (t) => {
  await t.test('searchBadgeDefinitions main definition view', async () => {
    const row = sqlNullColumns(definitionRow('null-indexed', {
      title: 'Null indexed badge', badgeType: 'certification', createdAt: '2025-01-01T00:00:00Z',
    }), 'indexed_at');
    const profile = sqlNullColumns(sidecarRow(profileCollection, issuer, 'profile-null-indexed', { displayName: 'Author' }), 'indexed_at');
    const organization = sqlNullColumns(sidecarRow(organizationCollection, issuer, 'organization-null-indexed', { visibility: 'public' }), 'indexed_at');
    runLua(await handlerSource('searchBadgeDefinitions'), {
      params: { search: 'Null indexed badge' },
      queryResults: [[row], [profile], [organization]],
      assertions: `
assert(result.badgeDefinitions[1].indexedAt == NULL_VALUE, 'indexedAt must be JSON null, not omitted')
assert(result.badgeDefinitions[1].author.profile.indexedAt == NULL_VALUE, 'profile indexedAt must be JSON null')
assert(result.badgeDefinitions[1].author.organization.indexedAt == NULL_VALUE, 'organization indexedAt must be JSON null')
`,
    });
  });

  await t.test('getBadgeAward main and nested views', async () => {
    const recipient = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
    const badgeUri = `at://${issuer}/${definitionCollection}/null-indexed`;
    const awardUri = `at://${issuer}/${awardCollection}/null-indexed`;
    const responseUri = `at://${recipient}/${responseCollection}/null-indexed`;
    const profile = sqlNullColumns(sidecarRow(profileCollection, issuer, 'award-profile-null-indexed', { displayName: 'Issuer' }), 'indexed_at');
    const organization = sqlNullColumns(sidecarRow(organizationCollection, issuer, 'award-organization-null-indexed', { visibility: 'public' }), 'indexed_at');
    const row = {
      uri: awardUri, did: issuer, cid: 'bafy-null-award', record: 'null-index-award',
      record_json: {
        $type: awardCollection, badge: { uri: badgeUri, cid: 'bafy-null-badge' },
        subject: recipient, createdAt: '2025-01-01T00:00:00Z',
      },
      badge_uri: badgeUri, badge_cid: 'bafy-null-badge', badge_did: issuer, badge_record: 'null-index-badge',
      recipient_response_uri: responseUri, recipient_response_cid: 'bafy-null-response',
      recipient_response_did: recipient, recipient_response_record: 'null-index-response',
    };
    runLua(await handlerSource('getBadgeAward'), {
      params: { uri: awardUri },
      queryResults: [[row], [profile], [organization]],
      recordValues: {
        'null-index-badge': { $type: definitionCollection, title: 'Badge' },
        'null-index-response': { $type: responseCollection, response: 'accepted' },
      },
      assertions: `
assert(result.badgeAward.indexedAt == NULL_VALUE, 'award indexedAt must be JSON null, not omitted')
assert(result.badgeAward.badge.indexedAt == NULL_VALUE, 'nested badge indexedAt must be JSON null, not omitted')
assert(result.badgeAward.recipientResponse.indexedAt == NULL_VALUE,
  'nested recipient response indexedAt must be JSON null, not omitted')
assert(result.badgeAward.author.profile.indexedAt == NULL_VALUE, 'profile indexedAt must be JSON null')
assert(result.badgeAward.author.organization.indexedAt == NULL_VALUE, 'organization indexedAt must be JSON null')
`,
    });
  });

  await t.test('listBadgeAwards main and nested views', async () => {
    const recipient = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
    const badgeUri = `at://${issuer}/${definitionCollection}/null-indexed`;
    const awardUri = `at://${issuer}/${awardCollection}/null-indexed-list`;
    const responseUri = `at://${recipient}/${responseCollection}/null-indexed-list`;
    const profile = sqlNullColumns(sidecarRow(profileCollection, issuer, 'list-award-profile-null-indexed', { displayName: 'Issuer' }), 'indexed_at');
    const organization = sqlNullColumns(sidecarRow(organizationCollection, issuer, 'list-award-organization-null-indexed', { visibility: 'public' }), 'indexed_at');
    const row = {
      uri: awardUri, did: issuer, cid: 'bafy-null-award-list', record: 'null-index-award-list',
      record_json: {
        $type: awardCollection, badge: { uri: badgeUri, cid: 'bafy-null-badge' },
        subject: recipient, createdAt: '2025-01-01T00:00:00Z',
      },
      badge_uri: badgeUri, badge_cid: 'bafy-null-badge', badge_did: issuer, badge_record: 'null-index-badge-list',
      recipient_response_uri: responseUri, recipient_response_cid: 'bafy-null-response',
      recipient_response_did: recipient, recipient_response_record: 'null-index-response-list',
      sort_timestamp: '2025-01-01T00:00:00.000000Z',
    };
    runLua(await handlerSource('listBadgeAwards'), {
      params: { limit: '1' },
      queryResults: [[row], [profile], [organization]],
      recordValues: {
        'null-index-badge-list': { $type: definitionCollection, title: 'Badge' },
        'null-index-response-list': { $type: responseCollection, response: 'accepted' },
      },
      assertions: `
assert(result.badgeAwards[1].indexedAt == NULL_VALUE, 'award indexedAt must be JSON null, not omitted')
assert(result.badgeAwards[1].badge.indexedAt == NULL_VALUE, 'nested badge indexedAt must be JSON null, not omitted')
assert(result.badgeAwards[1].recipientResponse.indexedAt == NULL_VALUE,
  'nested recipient response indexedAt must be JSON null, not omitted')
assert(result.badgeAwards[1].author.profile.indexedAt == NULL_VALUE, 'profile indexedAt must be JSON null')
assert(result.badgeAwards[1].author.organization.indexedAt == NULL_VALUE, 'organization indexedAt must be JSON null')
`,
    });
  });

  await t.test('getBadgeResponse main view', async () => {
    const responseUri = `at://${issuer}/${responseCollection}/null-indexed`;
    const profile = sqlNullColumns(sidecarRow(profileCollection, issuer, 'response-profile-null-indexed', { displayName: 'Publisher' }), 'indexed_at');
    const organization = sqlNullColumns(sidecarRow(organizationCollection, issuer, 'response-organization-null-indexed', { visibility: 'public' }), 'indexed_at');
    const row = {
      uri: responseUri, did: issuer, cid: 'bafy-null-response', record: 'null-indexed-response',
      record_json: { $type: responseCollection, response: 'deferred' },
    };
    runLua(await handlerSource('getBadgeResponse'), {
      params: { uri: responseUri },
      queryResults: [[row], [profile], [organization]],
      assertions: `
assert(result.badgeResponse.indexedAt == NULL_VALUE, 'indexedAt must be JSON null, not omitted')
assert(result.badgeResponse.author.profile.indexedAt == NULL_VALUE, 'profile indexedAt must be JSON null')
assert(result.badgeResponse.author.organization.indexedAt == NULL_VALUE, 'organization indexedAt must be JSON null')
`,
    });
  });

  await t.test('listBadgeResponses main view', async () => {
    const responseUri = `at://${issuer}/${responseCollection}/null-indexed-list`;
    const profile = sqlNullColumns(sidecarRow(profileCollection, issuer, 'list-response-profile-null-indexed', { displayName: 'Publisher' }), 'indexed_at');
    const organization = sqlNullColumns(sidecarRow(organizationCollection, issuer, 'list-response-organization-null-indexed', { visibility: 'public' }), 'indexed_at');
    const row = {
      uri: responseUri, did: issuer, cid: 'bafy-null-response-list', record: 'null-indexed-response-list',
      record_json: { $type: responseCollection, response: 'accepted', createdAt: '2025-01-01T00:00:00Z' },
      sort_timestamp: '2025-01-01T00:00:00.000000Z',
    };
    runLua(await handlerSource('listBadgeResponses'), {
      params: { limit: '1' },
      queryResults: [[row], [profile], [organization]],
      assertions: `
assert(result.badgeResponses[1].indexedAt == NULL_VALUE, 'indexedAt must be JSON null, not omitted')
assert(result.badgeResponses[1].author.profile.indexedAt == NULL_VALUE, 'profile indexedAt must be JSON null')
assert(result.badgeResponses[1].author.organization.indexedAt == NULL_VALUE, 'organization indexedAt must be JSON null')
`,
    });
  });
});

test('badge list timestamp fallback SQL preserves the emitted search cursor', async () => {
  const fallbackTimestamp = '2025-01-02T03:04:05.123456Z';
  const lookaheadTimestamp = '2025-01-01T03:04:05.123456Z';
  const first = sqlNullColumns(definitionRow('missing-created-at', {
    title: 'Missing createdAt badge', badgeType: 'certification',
  }, fallbackTimestamp), 'indexed_at');
  first.created_at = fallbackTimestamp;
  const lookahead = sqlNullColumns(definitionRow('malformed-created-at', {
    title: 'Malformed createdAt badge', badgeType: 'certification', createdAt: 'not-a-datetime',
  }, lookaheadTimestamp), 'indexed_at');
  lookahead.created_at = lookaheadTimestamp;

  runLua(await handlerSource('searchBadgeDefinitions'), {
    params: { search: 'badge', limit: '1' },
    queryResults: [[first, lookahead], [], []],
    assertions: `
assert(#result.badgeDefinitions == 1 and result.cursor ~= nil)
local cursor = json.decode(result.cursor)
assert(cursor.d == 'desc' and cursor.t == '${fallbackTimestamp}' and cursor.u == '${first.uri}')
local sql = calls[1].sql
assert(sql:find("jsonb_typeof(record::jsonb->'createdAt') = 'string'", 1, true))
assert(sql:find("pg_input_is_valid(record::jsonb->>'createdAt', 'timestamptz')", 1, true))
assert(sql:find('COALESCE(indexed_at::timestamptz, created_at::timestamptz)', 1, true))
assert(sql:find('ORDER BY sorted.sort_at DESC, uri DESC', 1, true))
params.cursor = result.cursor
local next_page = handle()
assert(#next_page.badgeDefinitions == 0)
local cursor_sql = calls[4].sql
assert(cursor_sql:find('(sorted.sort_at, uri) <', 1, true))
assert(calls[4].values[3] == '${fallbackTimestamp}' and calls[4].values[4] == '${first.uri}')
`,
  });
});

test('badge list timestamp fallback SQL preserves the emitted award cursor', async () => {
  const fallbackTimestamp = '2025-01-02T03:04:05.123456Z';
  const lookaheadTimestamp = '2025-01-01T03:04:05.123456Z';
  const makeAward = (rkey, createdAt, sortTimestamp) => {
    const record = { $type: awardCollection, badge: { uri: `at://${issuer}/${definitionCollection}/badge`, cid: 'bafy-badge' }, subject: issuer };
    if (createdAt !== undefined) record.createdAt = createdAt;
    const row = {
      uri: `at://${issuer}/${awardCollection}/${rkey}`, did: issuer, cid: `bafy-${rkey}`,
      record: `record-${rkey}`, record_json: record, created_at: sortTimestamp, sort_timestamp: sortTimestamp,
    };
    return sqlNullColumns(row, 'indexed_at');
  };
  const first = makeAward('malformed-created-at', '2025-02-30T00:00:00Z', fallbackTimestamp);
  const lookahead = makeAward('missing-created-at', undefined, lookaheadTimestamp);

  runLua(await handlerSource('listBadgeAwards'), {
    params: { limit: '1' },
    queryResults: [[first, lookahead], [], []],
    assertions: `
assert(#result.badgeAwards == 1 and result.cursor ~= nil)
local cursor = json.decode(result.cursor)
assert(cursor.d == 'desc' and cursor.t == '${fallbackTimestamp}' and cursor.u == '${first.uri}')
local sql = calls[1].sql
assert(sql:find("jsonb_typeof(award.record::jsonb->'createdAt') = 'string'", 1, true))
assert(sql:find("pg_input_is_valid(award.record::jsonb->>'createdAt', 'timestamptz')", 1, true))
assert(sql:find('COALESCE(award.indexed_at::timestamptz, award.created_at::timestamptz)', 1, true))
assert(sql:find('ORDER BY sorted.sort_at DESC, award.uri DESC', 1, true))
params.cursor = result.cursor
local next_page = handle()
assert(#next_page.badgeAwards == 0)
local cursor_sql = calls[4].sql
assert(cursor_sql:find('(sorted.sort_at, award.uri) <', 1, true))
assert(calls[4].values[2] == '${fallbackTimestamp}' and calls[4].values[3] == '${first.uri}')
`,
  });
});

test('badge list timestamp fallback SQL preserves the emitted response cursor', async () => {
  const fallbackTimestamp = '2025-01-02T03:04:05.123456Z';
  const lookaheadTimestamp = '2025-01-01T03:04:05.123456Z';
  const makeResponse = (rkey, createdAt, sortTimestamp) => {
    const record = { $type: responseCollection, badgeAward: { uri: `at://${issuer}/${awardCollection}/award`, cid: 'bafy-award' }, response: 'accepted' };
    if (createdAt !== undefined) record.createdAt = createdAt;
    const row = {
      uri: `at://${issuer}/${responseCollection}/${rkey}`, did: issuer, cid: `bafy-${rkey}`,
      record: `record-${rkey}`, record_json: record, created_at: sortTimestamp, sort_timestamp: sortTimestamp,
    };
    return sqlNullColumns(row, 'indexed_at');
  };
  const first = makeResponse('missing-created-at', undefined, fallbackTimestamp);
  const lookahead = makeResponse('malformed-created-at', 'not-a-datetime', lookaheadTimestamp);

  runLua(await handlerSource('listBadgeResponses'), {
    params: { limit: '1' },
    queryResults: [[first, lookahead], [], []],
    assertions: `
assert(#result.badgeResponses == 1 and result.cursor ~= nil)
local cursor = json.decode(result.cursor)
assert(cursor.d == 'desc' and cursor.t == '${fallbackTimestamp}' and cursor.u == '${first.uri}')
local sql = calls[1].sql
assert(sql:find("jsonb_typeof(response.record::jsonb->'createdAt') = 'string'", 1, true))
assert(sql:find("pg_input_is_valid(response.record::jsonb->>'createdAt', 'timestamptz')", 1, true))
assert(sql:find('COALESCE(response.indexed_at::timestamptz, response.created_at::timestamptz)', 1, true))
assert(sql:find('ORDER BY sorted.sort_at DESC, response.uri DESC', 1, true))
params.cursor = result.cursor
local next_page = handle()
assert(#next_page.badgeResponses == 0)
local cursor_sql = calls[4].sql
assert(cursor_sql:find('(sorted.sort_at, response.uri) <', 1, true))
assert(calls[4].values[2] == '${fallbackTimestamp}' and calls[4].values[3] == '${first.uri}')
`,
  });
});
