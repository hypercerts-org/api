import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative) => readFile(path.resolve(root, relative), 'utf8');

async function endpointSources(name) {
  const shared = [
    'lua/shared/didValidation.lua',
    'lua/shared/query.lua',
    'lua/shared/recordIdentifier.lua',
    'lua/shared/rightsIdentifier.lua',
    'lua/shared/recordView.lua',
    'lua/shared/actorView.lua',
    'lua/shared/rightsView.lua',
  ];
  if (name === 'listRights') shared.push('lua/shared/datetimeValidation.lua', 'lua/shared/listValidation.lua', 'lua/shared/listQuery.lua');
  return Promise.all([...shared, `lua/src/${name}.lua`].map(read));
}

function runLua(program) {
  execFileSync('lua', ['-'], { input: program, encoding: 'utf8' });
}

test('getRights accepts opaque DID percent sequences and retains invalid-DID boundaries', async () => {
  const sources = await endpointSources('getRights');
  const program = [
    `local null_value = {}
    local rights_record = { rightsName = "Terms" }`,
    `json = { decode = function(value)
      if value == "null" then return null_value end
      if value == "rights-record" then return rights_record end
      error("unexpected JSON input")
    end }`,
    `local broad_uri = "at://did:plc:publisher%GG/org.hypercerts.claim.rights/key"
    params = { uri = broad_uri }
    local query_count = 0
    local query_values = {}
    local record_exists = true
    db = {
      backend = function() return "postgres" end,
      raw = function(sql, values)
        query_count = query_count + 1
        query_values[query_count] = values
        if values[1] == "org.hypercerts.claim.rights" then
          if not record_exists then return {} end
          return {{ uri = params.uri, did = "did:plc:publisher", cid = "cid", indexed_at = nil, record = "rights-record" }}
        end
        return {}
      end
    }`,
    ...sources,
    `local response = handle()
    assert(response.rights.uri == broad_uri and query_values[1][2] == broad_uri,
      "opaque percent sequences in the DID must reach exact lookup unchanged")
    assert(response.rights.indexedAt == null_value, "SQL NULL is returned as JSON null")
    assert(response.rights.record.rightsName == "Terms")
    assert(response.rights.author.profile == null_value)
    assert(response.rights.author.organization == null_value)
    assert(query_count == 3, "exact lookup and sidecar hydration should run")
    params.uri = "at://did:plc:publisher%/org.hypercerts.claim.rights/key"
    local invalid_ok, invalid_error = pcall(handle)
    assert(not invalid_ok and tostring(invalid_error):find("InvalidRequest", 1, true))
    assert(query_count == 3, "trailing percent remains an invalid DID boundary")
    params.uri = "at://did:plc:publisher/org.hypercerts.claim.rights/key"
    record_exists = false
    local missing_ok, missing_error = pcall(handle)
    assert(not missing_ok and tostring(missing_error):find("RecordNotFound", 1, true))`,
  ].join('\n\n');

  runLua(program);
});

test('listRights orders invalid or absent createdAt by indexed_at then row creation without rewriting records', async () => {
  const sources = await endpointSources('listRights');
  const program = [
    `local null_value = {}
    local records = {
      created = { rightsName = "CreatedAt", createdAt = "2024-01-01T00:00:00Z" },
      indexed = { rightsName = "Indexed fallback" },
      stored = { rightsName = "Stored fallback", createdAt = "not-a-datetime" }
    }`,
    `json = { decode = function(value)
      if value == "null" then return null_value end
      return assert(records[value], "unexpected JSON input")
    end }`,
    `params = { sortDirection = "asc", limit = "10" }`,
    `local rows = {
      { uri = "at://did:plc:alice/org.hypercerts.claim.rights/created", did = "did:plc:alice", cid = "cid-a", indexed_at = "2024-01-04T00:00:00Z", created_at = "2024-01-04T00:00:00Z", record = "created", sort_timestamp = "2024-01-01T00:00:00.000000Z" },
      { uri = "at://did:plc:alice/org.hypercerts.claim.rights/indexed", did = "did:plc:alice", cid = "cid-b", indexed_at = "2024-01-02T00:00:00Z", created_at = "2024-01-03T00:00:00Z", record = "indexed", sort_timestamp = "2024-01-02T00:00:00.000000Z" },
      { uri = "at://did:plc:alice/org.hypercerts.claim.rights/stored", did = "did:plc:alice", cid = "cid-c", indexed_at = nil, created_at = "2024-01-03T00:00:00Z", record = "stored", sort_timestamp = "2024-01-03T00:00:00.000000Z" }
    }`,
    `db = {
      backend = function() return "postgres" end,
      raw = function(sql, values)
        if values[1] == "app.certified.actor.profile" or values[1] == "app.certified.actor.organization" then return {} end
        assert(sql:find("COALESCE(rights.indexed_at::timestamptz, rights.created_at::timestamptz)", 1, true), "sort must fall back to indexed_at and row creation")
        local result = {}
        for _, row in ipairs(rows) do result[#result + 1] = row end
        return result
      end
    }
    toarray = function(value) return value end`,
    ...sources,
    `local response = handle()
    assert(#response.rights == 3, "missing or malformed createdAt does not exclude rights")
    assert(response.rights[1].record.rightsName == "CreatedAt")
    assert(response.rights[2].record.rightsName == "Indexed fallback")
    assert(response.rights[3].record.rightsName == "Stored fallback")
    assert(response.rights[2].record.createdAt == nil, "the source record is not given a synthetic timestamp")
    assert(response.rights[3].record.createdAt == "not-a-datetime", "the malformed source value remains unchanged")
    assert(response.rights[3].indexedAt == null_value, "nullable indexedAt is retained as JSON null")`,
  ].join('\n\n');

  runLua(program);
});

test('listRights accepts broad DIDs in filters and cursors but rejects invalid DID and timestamp boundaries', async () => {
  const sources = await endpointSources('listRights');
  const program = [
    `local null_value = {}`,
    `json = {
      decode = function(value)
        if value == "null" then return null_value end
        local version, direction, timestamp, uri = value:match('^{"v":(%d+),"d":"([^"]+)","t":"([^"]+)","u":"([^"]+)"}$')
        if version then return { v = tonumber(version), d = direction, t = timestamp, u = uri } end
        error("unexpected JSON input")
      end
    }`,
    `local function hex(value)
      return (value:gsub(".", function(char) return string.format("%02x", string.byte(char)) end))
    end
    local function cursor(timestamp, uri)
      return hex('{"v":1,"d":"desc","t":"' .. timestamp .. '","u":"' .. uri .. '"}')
    end`,
    `local query_count = 0
    local query_values = {}
    db = {
      backend = function() return "postgres" end,
      raw = function(sql, values)
        query_count = query_count + 1
        query_values[query_count] = values
        return {}
      end
    }
    toarray = function(value) return value end`,
    ...sources,
    `local function invalid_request()
      local previous_queries = query_count
      local ok, err = pcall(handle)
      assert(not ok and tostring(err):find("InvalidRequest", 1, true))
      assert(query_count == previous_queries, "invalid inputs must fail before database access")
    end
    params = { authors = { "did:plc:publisher%GG" } }
    local filtered = handle()
    assert(#filtered.rights == 0 and query_values[1][2] == "did:plc:publisher%GG",
      "opaque percent sequences in author DIDs must reach the list query")
    local broad_cursor_uri = "at://did:plc:publisher%GG/org.hypercerts.claim.rights/key"
    params = { cursor = cursor("2025-01-01T00:00:00Z", broad_cursor_uri) }
    handle()
    assert(query_values[2][3] == broad_cursor_uri, "broad DID cursor URI must reach the list query")
    params = { authors = { "did:plc:publisher%" } }
    invalid_request()
    params = { cursor = cursor("0000-01-01T00:00:00Z", "at://did:plc:publisher/org.hypercerts.claim.rights/key") }
    invalid_request()`,
  ].join('\n\n');

  runLua(program);
});

test('listRights rejects repeated scalar, unknown, and oversized author parameters before querying', async () => {
  const sources = await endpointSources('listRights');
  const program = [
    `local null_value = {}`,
    `json = { decode = function(value) assert(value == "null"); return null_value end }`,
    `local query_count = 0
    db = {
      backend = function() return "postgres" end,
      raw = function() query_count = query_count + 1; return {} end
    }
    toarray = function(value) return value end`,
    ...sources,
    `local function invalid_request()
      local ok, err = pcall(handle)
      assert(not ok and tostring(err):find("InvalidRequest", 1, true))
    end
    params = { limit = { "2", "3" } }
    invalid_request()
    params = { unexpected = "value" }
    invalid_request()
    local authors = {}
    for index = 1, 101 do authors[index] = "did:plc:author" .. index end
    params = { authors = authors }
    invalid_request()
    assert(query_count == 0, "invalid parameters must fail before database access")`,
  ].join('\n\n');

  runLua(program);
});
