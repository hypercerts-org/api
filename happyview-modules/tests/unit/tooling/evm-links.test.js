import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const moduleFile = path.join(root, 'modules/evm-links/manifest.json');
const did = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz';
const uri = `at://${did}/app.certified.link.evm/wallet-1`;

async function handlerSource(id) {
  const module = JSON.parse(await readFile(moduleFile, 'utf8'));
  const handler = module.assets.find((asset) => asset.id === `xrpc.query:app.certified.link.${id}`);
  assert.ok(handler, `the EVM-link ${id} query must be declared as an installable handler`);
  const moduleRoot = path.dirname(moduleFile);
  const files = [...handler.sharedSourcePaths, handler.sourcePath].map((file) => path.resolve(moduleRoot, file));
  return (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n\n');
}

async function getEvmLinkSource() {
  return handlerSource('getEvmLink');
}

async function listEvmLinksSource() {
  return handlerSource('listEvmLinks');
}

function luaLiteral(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `{ ${value.map(luaLiteral).join(', ')} }`;
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value).map(([key, entry]) => `[${JSON.stringify(key)}] = ${luaLiteral(entry)}`).join(', ')} }`;
  }
  throw new TypeError(`Unsupported Lua fixture value: ${String(value)}`);
}

async function runListLua({ params: request, pages = [], extraDecoded = [], assertions }) {
  const source = await listEvmLinksSource();
  const normalizedPages = pages.map((page) => page.map((row) => ({
    ...row,
    record: JSON.stringify(row.record),
  })));
  const decodedRecords = {};
  for (const page of pages) for (const row of page) decodedRecords[JSON.stringify(row.record)] = row.record;
  const decodedMap = Object.fromEntries(extraDecoded.map(({ json, value }) => [json, value]));
  const lua = `
local null = {}
local did = ${JSON.stringify(did)}
local uri = ${JSON.stringify(uri)}
local page_rows = ${luaLiteral(normalizedPages)}
local decoded_records = ${luaLiteral(decodedRecords)}
local extra_decoded = ${luaLiteral(decodedMap)}
local list_calls = 0
local list_queries = {}
local encoded_cursor_text
local encoded_cursor_value
json = {
  decode = function(value)
    if value == 'null' then return null end
    if decoded_records[value] then return decoded_records[value] end
    if extra_decoded[value] then return extra_decoded[value] end
    if value == encoded_cursor_text then return encoded_cursor_value end
    error('unexpected JSON fixture: ' .. value)
  end,
  encode = function(value)
    encoded_cursor_value = value
    encoded_cursor_text = string.format('{"v":%d,"d":"%s","t":"%s","u":"%s"}', value.v, value.d, value.t, value.u)
    return encoded_cursor_text
  end,
}
params = ${luaLiteral(request)}
toarray = function(value) return value end
db = {
  backend = function() return 'postgres' end,
  raw = function(sql, values)
    if values[1] == 'app.certified.link.evm' then
      list_calls = list_calls + 1
      list_queries[list_calls] = { sql = sql, values = values }
      return page_rows[list_calls] or {}
    end
    return {}
  end,
}
${source}
${assertions}
`;
  const execution = spawnSync('lua5.4', ['-'], { input: lua, encoding: 'utf8' });
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
}

test('getEvmLink uses shared DID validation and preserves exact-URI constraints', async () => {
  const source = await getEvmLinkSource();
  const invalidUris = [
    'at://did:plc1:abc/app.certified.link.evm/record',
    'at://did:plc:abc:/app.certified.link.evm/record',
    'at://did:plc:abc/app.certified.link.evm/record?version=1',
    'at://did:plc:abc/app.certified.link.evm/record#fragment',
  ];
  const acceptedUris = [
    'at://did:plc:abc%GG/app.certified.link.evm/record',
    'at://did:plc:abc::def/app.certified.link.evm/record',
    'at://did:plc::abc/app.certified.link.evm/record',
    'at://did:web:example.com%3A3000:users:alice/app.certified.link.evm/record',
  ];
  const lua = `
local null = {}
json = { decode = function(value) if value == 'null' then return null end error('unexpected JSON') end }
local lookup_count = 0
local lookup_queries = {}
params = {}
db = {
  backend = function() return 'postgres' end,
  raw = function(sql, values)
    lookup_count = lookup_count + 1
    lookup_queries[lookup_count] = { sql = sql, values = values }
    return {}
  end,
}
${source}
for _, invalid_uri in ipairs(${luaLiteral(invalidUris)}) do
  params = { uri = invalid_uri }
  local ok, err = pcall(handle)
  assert(not ok and tostring(err):find('InvalidRequest:', 1, true), 'invalid DID or URI constraints must be rejected')
end
assert(lookup_count == 0, 'invalid DID and query/fragment URIs must not reach exact lookup')
local accepted_uris = ${luaLiteral(acceptedUris)}
for index, accepted_uri in ipairs(accepted_uris) do
  params = { uri = accepted_uri }
  local ok, err = pcall(handle)
  assert(not ok and tostring(err):find('RecordNotFound:', 1, true), 'shared-valid DIDs must reach exact lookup')
  assert(lookup_queries[index].values[2] == accepted_uri, 'exact lookup must bind each accepted URI unchanged')
end
assert(lookup_count == #accepted_uris, 'each shared-valid DID must issue an exact lookup')
`;
  const execution = spawnSync('lua5.4', ['-'], { input: lua, encoding: 'utf8' });
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
});

test('getEvmLink returns the exact record with its original proof and hydrated nullable actor', async () => {
  const source = await getEvmLinkSource();
  const linkRaw = JSON.stringify({
    address: '0xAa00000000000000000000000000000000000001',
    proof: {
      $type: 'app.certified.link.evm#eip712Proof',
      signature: `0x${'1'.repeat(128)}`,
      message: {
        $type: 'app.certified.link.evm#eip712Message',
        did,
        evmAddress: '0xAa00000000000000000000000000000000000001',
        chainId: '1',
        timestamp: '1700000000',
        nonce: '7',
      },
    },
    createdAt: '2024-01-02T03:04:05.000Z',
  });
  const profileRaw = JSON.stringify({ displayName: 'Ada' });
  const lua = `
local did = ${JSON.stringify(did)}
local uri = ${JSON.stringify(uri)}
local link_raw = ${JSON.stringify(linkRaw)}
local profile_raw = ${JSON.stringify(profileRaw)}
local null = {}
local link_record = {
  address = '0xAa00000000000000000000000000000000000001',
  proof = {
    ['$type'] = 'app.certified.link.evm#eip712Proof',
    signature = '0x${'1'.repeat(128)}',
    message = { ['$type'] = 'app.certified.link.evm#eip712Message', did = did, evmAddress = '0xAa00000000000000000000000000000000000001', chainId = '1', timestamp = '1700000000', nonce = '7' },
  },
  createdAt = '2024-01-02T03:04:05.000Z',
}
json = {
  decode = function(value)
    if value == 'null' then return null end
    if value == link_raw then return link_record end
    if value == profile_raw then return { displayName = 'Ada' } end
    error('unexpected JSON fixture: ' .. value)
  end,
  encode = function() error('cursor encoding is not used by this lookup test') end,
}
params = { uri = uri }
local direct_lookup
local profile_lookup
local organization_lookup
db = {
  backend = function() return 'postgres' end,
  raw = function(sql, values)
    if values[1] == 'app.certified.link.evm' then
      direct_lookup = { sql = sql, values = values }
      return {{ uri = uri, did = did, cid = 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', indexed_at = '2024-01-02T03:05:00Z', record = link_raw }}
    end
    if values[1] == 'app.certified.actor.profile' then
      profile_lookup = { sql = sql, values = values }
      return {{ uri = 'at://' .. did .. '/app.certified.actor.profile/self', did = did, cid = 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', indexed_at = '2024-01-02T03:06:00Z', record = profile_raw }}
    end
    if values[1] == 'app.certified.actor.organization' then
      organization_lookup = { sql = sql, values = values }
      return {}
    end
    error('unexpected collection: ' .. tostring(values[1]))
  end,
}
${source}
local result = handle()
assert(direct_lookup and direct_lookup.values[2] == uri, 'lookup must bind the exact requested AT-URI')
assert(direct_lookup.sql:find('WHERE collection = $1 AND uri = $2', 1, true), 'lookup must use exact URI equality')
assert(result.evmLink.uri == uri and result.evmLink.did == did)
assert(result.evmLink.record.address == link_record.address)
assert(result.evmLink.record.proof.signature == link_record.proof.signature)
assert(result.evmLink.record.proof.message.nonce == '7')
assert(result.evmLink.actor.did == did)
assert(result.evmLink.actor.profile.record.displayName == 'Ada')
assert(result.evmLink.actor.organization == null, 'missing organization must be JSON null')
assert(profile_lookup and organization_lookup, 'actor hydration must check both Certified sidecars')
`;
  const execution = spawnSync('lua5.4', ['-'], { input: lua, encoding: 'utf8' });
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
});

test('getEvmLink emits explicit null indexedAt values for the link and hydrated sidecars', async () => {
  const source = await getEvmLinkSource();
  const linkRecord = { address: '0xAa00000000000000000000000000000000000001', proof: { signature: 'unchanged' }, createdAt: '2024-01-02T03:04:05Z' };
  const profileRecord = { displayName: 'Ada' };
  const organizationRecord = { name: 'Example' };
  const rawRecords = {
    [JSON.stringify(linkRecord)]: linkRecord,
    [JSON.stringify(profileRecord)]: profileRecord,
    [JSON.stringify(organizationRecord)]: organizationRecord,
  };
  const lua = `
local did = ${JSON.stringify(did)}
local uri = ${JSON.stringify(uri)}
local link_raw = ${JSON.stringify(JSON.stringify(linkRecord))}
local profile_raw = ${JSON.stringify(JSON.stringify(profileRecord))}
local organization_raw = ${JSON.stringify(JSON.stringify(organizationRecord))}
local records = ${luaLiteral(rawRecords)}
local null = {}
json = { decode = function(value) if value == 'null' then return null end return records[value] end }
params = { uri = uri }
db = {
  backend = function() return 'postgres' end,
  raw = function(_, values)
    if values[1] == 'app.certified.link.evm' then
      return {{ uri = uri, did = did, cid = 'cid-link', indexed_at = nil, record = link_raw }}
    end
    if values[1] == 'app.certified.actor.profile' then
      return {{ uri = 'at://' .. did .. '/app.certified.actor.profile/self', did = did, cid = 'cid-profile', indexed_at = nil, record = profile_raw }}
    end
    if values[1] == 'app.certified.actor.organization' then
      return {{ uri = 'at://' .. did .. '/app.certified.actor.organization/self', did = did, cid = 'cid-org', indexed_at = nil, record = organization_raw }}
    end
    error('unexpected collection: ' .. tostring(values[1]))
  end,
}
${source}
local result = handle()
assert(result.evmLink.indexedAt == null, 'SQL NULL on the link must serialize as JSON null')
assert(result.evmLink.actor.profile.indexedAt == null, 'SQL NULL on the profile sidecar must serialize as JSON null')
assert(result.evmLink.actor.organization.indexedAt == null, 'SQL NULL on the organization sidecar must serialize as JSON null')
assert(result.evmLink.record.proof.signature == 'unchanged')
`;
  const execution = spawnSync('lua5.4', ['-'], { input: lua, encoding: 'utf8' });
  assert.equal(execution.status, 0, execution.stderr || execution.stdout);
});

test('listEvmLinks keeps malformed and missing createdAt records visible and uses fallback sort timestamps', async () => {
  const invalidRecord = {
    address: '0xAa00000000000000000000000000000000000001',
    proof: { signature: 'preserve-invalid-time' },
    createdAt: 'not-a-datetime',
  };
  const missingRecord = {
    address: '0xBb00000000000000000000000000000000000002',
    proof: { signature: 'preserve-missing-time' },
  };
  const rows = [
    { uri: `at://${did}/app.certified.link.evm/invalid-time`, did, cid: 'cid-invalid', indexed_at: '2024-01-01T00:00:00Z', sort_timestamp: '2024-01-01T00:00:00.000000Z', record: invalidRecord },
    { uri: `at://${did}/app.certified.link.evm/missing-time`, did, cid: 'cid-missing', sort_timestamp: '2024-01-02T00:00:00.000000Z', record: missingRecord },
  ];
  await runListLua({ params: { sortDirection: 'asc', limit: '2' }, pages: [rows], assertions: `
local result = handle()
assert(#result.evmLinks == 2, 'invalid and missing createdAt values must not hide records')
assert(result.evmLinks[1].record.createdAt == 'not-a-datetime')
assert(result.evmLinks[1].record.proof.signature == 'preserve-invalid-time')
assert(result.evmLinks[2].record.createdAt == nil, 'the source record must not be rewritten')
assert(result.evmLinks[2].record.proof.signature == 'preserve-missing-time')
assert(result.evmLinks[2].indexedAt == null, 'SQL NULL indexed_at must be explicit JSON null')
local sql = list_queries[1].sql
assert(sql:find("jsonb_typeof(link.record::jsonb->'createdAt') = 'string'", 1, true))
assert(sql:find('pg_input_is_valid', 1, true), 'untrusted timestamp casts must be guarded')
assert(sql:find('COALESCE(link.indexed_at::timestamptz, link.created_at::timestamptz)', 1, true), 'missing or invalid timestamps must fall back to index then row creation time')
assert(sql:find('ORDER BY sorted.sort_at ASC, link.uri ASC', 1, true))
` });
});

test('listEvmLinks combines actor/address filters, normalizes matching only, and continues with a stable opaque cursor', async () => {
  const did2 = 'did:web:example.com';
  const firstUri = `at://${did}/app.certified.link.evm/wallet-1`;
  const address = '0xAa00000000000000000000000000000000000001';
  const address2 = '0xBB00000000000000000000000000000000000002';
  const cursorTime = '2024-01-02T03:04:05.123456Z';
  const record = (account) => ({
    address: account,
    proof: { $type: 'app.certified.link.evm#eip712Proof', signature: 'original-proof' },
    createdAt: '2024-01-02T03:04:05.123456Z',
  });
  const rows = [
    { uri: firstUri, did, cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', indexed_at: '2024-01-02T03:05:00Z', sort_timestamp: cursorTime, record: record(address) },
    { uri: `at://${did2}/app.certified.link.evm/wallet-2`, did: did2, cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', indexed_at: '2024-01-02T03:05:00Z', sort_timestamp: '2024-01-03T03:04:05.123456Z', record: record('0xBb00000000000000000000000000000000000002') },
  ];
  const cursorJSON = JSON.stringify({ v: 1, d: 'asc', t: cursorTime, u: firstUri });
  const request = { actors: [did, did2], addresses: [address.toLowerCase(), address2], sortDirection: 'asc', limit: '1' };
  const resumeRequest = { ...request, cursor: Buffer.from(cursorJSON).toString('hex') };

  await runListLua({ params: request, pages: [rows, []], assertions: `
local first_page = handle()
assert(#first_page.evmLinks == 1)
assert(first_page.evmLinks[1].uri == uri)
assert(first_page.evmLinks[1].record.address == '${address}', 'the response must preserve the original address casing')
assert(first_page.evmLinks[1].record.proof.signature == 'original-proof')
assert(first_page.evmLinks[1].actor.did == did)
assert(first_page.evmLinks[1].actor.profile == null and first_page.evmLinks[1].actor.organization == null)
assert(type(first_page.cursor) == 'string' and #first_page.cursor > 0)
assert(encoded_cursor_value.v == 1 and encoded_cursor_value.d == 'asc')
assert(encoded_cursor_value.t == '${cursorTime}' and encoded_cursor_value.u == uri)
local first_query = list_queries[1]
assert(first_query.values[1] == 'app.certified.link.evm')
assert(first_query.values[2] == '${did}' and first_query.values[3] == '${did2}')
assert(first_query.values[4] == '${address.toLowerCase()}' and first_query.values[5] == '${address2.toLowerCase()}')
assert(first_query.values[6] == 2)
assert(first_query.sql:find('link.did IN ($2,$3)', 1, true), 'actor values must use OR within their filter')
assert(first_query.sql:find("lower(link.record::jsonb->>'address') IN ($4,$5)", 1, true), 'address values must use OR within their filter')
assert(first_query.sql:find("link.did IN ($2,$3) AND lower(link.record::jsonb->>'address') IN ($4,$5)", 1, true), 'distinct filters must combine with AND')
assert(first_query.sql:find('ORDER BY sorted.sort_at ASC, link.uri ASC', 1, true))
assert(first_query.sql:find('LIMIT $6', 1, true))
params = ${luaLiteral(resumeRequest)}
local second_page = handle()
assert(#second_page.evmLinks == 0 and second_page.cursor == nil)
local second_query = list_queries[2]
assert(second_query.values[6] == '${cursorTime}' and second_query.values[7] == '${firstUri}')
assert(second_query.values[8] == 2)
assert(second_query.sql:find(') > (($6)::timestamptz, $7)', 1, true), 'cursor must resume strictly after the last key')
` });
});

test('listEvmLinks rejects invalid filters but accepts broad DIDs in actor filters and cursors', async () => {
  const cursorObject = { v: 1, d: 'asc', t: '2024-01-02T03:04:05Z', u: uri };
  const cursorJSON = JSON.stringify(cursorObject);
  const methodDid = 'did:plc1:abc';
  const methodUri = `at://${methodDid}/app.certified.link.evm/key`;
  const methodCursor = { v: 1, d: 'asc', t: '2024-01-02T03:04:05Z', u: methodUri };
  const methodCursorJSON = JSON.stringify(methodCursor);
  const escapedDid = 'did:web:example.com%3A3000:users:alice';
  const broadDids = ['did:plc:abc%GG', 'did:plc:abc::def', 'did:plc::abc'];
  const broadCursorUri = 'at://did:plc:cursor%GG/app.certified.link.evm/key';
  const broadCursor = { v: 1, d: 'asc', t: '2024-01-02T03:04:05Z', u: broadCursorUri };
  const broadCursorJSON = JSON.stringify(broadCursor);
  const invalidRequests = [
    { addresses: ['0xnot-an-address'] },
    { actors: ['not-a-did'] },
    { actors: ['did:plc:abc%'] },
    { actors: [methodDid] },
    { actors: Array.from({ length: 101 }, (_, index) => `did:plc:actor${index}`) },
    { addresses: Array(101).fill('0xAa00000000000000000000000000000000000001') },
    { limit: '0' },
    { sortDirection: 'sideways' },
    { unexpected: 'value' },
    { sortDirection: 'desc', cursor: Buffer.from(cursorJSON).toString('hex') },
    { sortDirection: 'asc', cursor: Buffer.from(methodCursorJSON).toString('hex') },
    { cursor: 'not-hex' },
  ];
  await runListLua({
    params: {},
    pages: [[]],
    extraDecoded: [
      { json: cursorJSON, value: cursorObject },
      { json: methodCursorJSON, value: methodCursor },
      { json: broadCursorJSON, value: broadCursor },
    ],
    assertions: `
local invalid_requests = ${luaLiteral(invalidRequests)}
for _, request in ipairs(invalid_requests) do
  params = request
  local ok, err = pcall(handle)
  assert(not ok and tostring(err):find('InvalidRequest:', 1, true), 'expected InvalidRequest for malformed query')
end
local broad_dids = ${luaLiteral(broadDids)}
for index, broad_did in ipairs(broad_dids) do
  params = { actors = { broad_did } }
  local result = handle()
  assert(#result.evmLinks == 0)
  assert(list_calls == index and list_queries[index].values[2] == broad_did,
    'broad DID actor filters must reach the query unchanged')
end
params = { actors = { '${escapedDid}' } }
local valid_result = handle()
assert(#valid_result.evmLinks == 0)
assert(list_calls == #broad_dids + 1 and list_queries[list_calls].values[2] == '${escapedDid}',
  'percent-encoded DIDs must reach the query')
params = { sortDirection = 'asc', cursor = '${Buffer.from(broadCursorJSON).toString('hex')}' }
local cursor_result = handle()
assert(#cursor_result.evmLinks == 0)
assert(list_calls == #broad_dids + 2 and list_queries[list_calls].values[3] == '${broadCursorUri}',
  'broad DID cursor URI must reach the query unchanged')
`,
  });
});
