import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative) => readFile(path.resolve(root, relative), 'utf8');

test('getRights returns the full indexed record and a nullable hydrated publisher', async () => {
  const [didValidation, query, recordIdentifier, rightsIdentifier, recordView, actorView, rightsView, getRights] = await Promise.all([
    read('lua/shared/didValidation.lua'),
    read('lua/shared/query.lua'),
    read('lua/shared/recordIdentifier.lua'),
    read('lua/shared/rightsIdentifier.lua'),
    read('lua/shared/recordView.lua'),
    read('lua/shared/actorView.lua'),
    read('lua/shared/rightsView.lua'),
    read('lua/src/getRights.lua'),
  ]);
  const program = [
    `local null_value = {}`,
    `local rights_record = {
      ["$type"] = "org.hypercerts.claim.rights",
      rightsName = "All Rights Reserved",
      rightsType = "ARR",
      rightsDescription = "Permission terms are retained in full.",
      attachment = { uri = "https://example.test/terms.pdf" },
      createdAt = "2025-02-03T04:05:06Z"
    }`,
    `json = {
      decode = function(value)
        if value == "null" then return null_value end
        if value == "rights-record" then return rights_record end
        if value == "profile-record" then return { displayName = "Rights publisher" } end
        if value == "organization-record" then return { name = "Rights publisher organization" } end
        error("unexpected JSON input: " .. tostring(value))
      end
    }`,
    `params = { uri = "at://did:plc:publisher/org.hypercerts.claim.rights/3jzfcijpj2z2a" }`,
    `db = {
      backend = function() return "postgres" end,
      raw = function(sql, values)
        if values[1] == "org.hypercerts.claim.rights" then
          assert(values[2] == params.uri, "lookup must use the exact supplied AT-URI")
          return {{
            uri = params.uri,
            did = "did:plc:publisher",
            cid = "bafyreifullrecord",
            indexed_at = "2025-02-03T04:06:00Z",
            record = "rights-record"
          }}
        end
        if values[1] == "app.certified.actor.profile" then
          return {{ uri = "at://did:plc:publisher/app.certified.actor.profile/self", did = "did:plc:publisher", cid = "profile-cid", indexed_at = nil, record = "profile-record" }}
        end
        if values[1] == "app.certified.actor.organization" then
          return {{ uri = "at://did:plc:publisher/app.certified.actor.organization/self", did = "did:plc:publisher", cid = "organization-cid", indexed_at = nil, record = "organization-record" }}
        end
        error("unexpected rights hydration query")
      end
    }`,
    didValidation,
    query,
    recordIdentifier,
    rightsIdentifier,
    recordView,
    actorView,
    rightsView,
    getRights,
    `local response = handle()
    assert(response.rights.uri == params.uri)
    assert(response.rights.cid == "bafyreifullrecord")
    assert(response.rights.indexedAt == "2025-02-03T04:06:00Z")
    assert(response.rights.did == "did:plc:publisher")
    assert(response.rights.record.rightsDescription == "Permission terms are retained in full.")
    assert(response.rights.record.attachment.uri == "https://example.test/terms.pdf")
    assert(response.rights.author.did == "did:plc:publisher")
    assert(response.rights.author.profile.indexedAt == null_value)
    assert(response.rights.author.profile.record.displayName == "Rights publisher")
    assert(response.rights.author.organization.indexedAt == null_value)
    assert(response.rights.author.organization.record.name == "Rights publisher organization")`,
  ].join('\n\n');

  execFileSync('lua', ['-'], { input: program, encoding: 'utf8' });
});

async function listRightsSources() {
  return Promise.all([
    read('lua/shared/didValidation.lua'),
    read('lua/shared/query.lua'),
    read('lua/shared/recordIdentifier.lua'),
    read('lua/shared/rightsIdentifier.lua'),
    read('lua/shared/recordView.lua'),
    read('lua/shared/actorView.lua'),
    read('lua/shared/rightsView.lua'),
    read('lua/shared/listValidation.lua'),
    read('lua/shared/listQuery.lua'),
    read('lua/src/listRights.lua'),
  ]);
}

test('listRights treats repeated authors as an OR filter', async () => {
  const sources = await listRightsSources();
  const program = [
    `local null_value = {}`,
    `local records = {
      one = { rightsName = "First" },
      two = { rightsName = "Second" },
      three = { rightsName = "Other publisher" },
      profile = { displayName = "Publisher" },
      organization = { name = "Publisher organization" }
    }`,
    `json = { decode = function(value)
      if value == "null" then return null_value end
      return assert(records[value], "unexpected JSON input")
    end }`,
    `params = { authors = { "did:plc:alice", "did:plc:bob" } }`,
    `local rows = {
      { uri = "at://did:plc:alice/org.hypercerts.claim.rights/a", did = "did:plc:alice", cid = "cid-a", indexed_at = "2025-01-01T00:00:00Z", record = "one", sort_timestamp = "2025-01-01T00:00:00.000000Z" },
      { uri = "at://did:plc:carol/org.hypercerts.claim.rights/c", did = "did:plc:carol", cid = "cid-c", indexed_at = "2025-01-03T00:00:00Z", record = "three", sort_timestamp = "2025-01-03T00:00:00.000000Z" },
      { uri = "at://did:plc:bob/org.hypercerts.claim.rights/b", did = "did:plc:bob", cid = "cid-b", indexed_at = "2025-01-02T00:00:00Z", record = "two", sort_timestamp = "2025-01-02T00:00:00.000000Z" }
    }`,
    `db = {
      backend = function() return "postgres" end,
      raw = function(sql, values)
        if values[1] == "app.certified.actor.profile" then
          return {
            { uri = "at://did:plc:alice/app.certified.actor.profile/self", did = "did:plc:alice", cid = "profile-a", indexed_at = nil, record = "profile" },
            { uri = "at://did:plc:bob/app.certified.actor.profile/self", did = "did:plc:bob", cid = "profile-b", indexed_at = nil, record = "profile" }
          }
        end
        if values[1] == "app.certified.actor.organization" then
          return {
            { uri = "at://did:plc:alice/app.certified.actor.organization/self", did = "did:plc:alice", cid = "organization-a", indexed_at = nil, record = "organization" },
            { uri = "at://did:plc:bob/app.certified.actor.organization/self", did = "did:plc:bob", cid = "organization-b", indexed_at = nil, record = "organization" }
          }
        end
        assert(values[1] == "org.hypercerts.claim.rights")
        assert(sql:find("rights.did IN", 1, true), "query must apply the author filter")
        assert(values[2] == "did:plc:alice" and values[3] == "did:plc:bob", "both authors must be bound")
        local result = {}
        for _, row in ipairs(rows) do
          if row.did == values[2] or row.did == values[3] then result[#result + 1] = row end
        end
        return result
      end
    }`,
    `toarray = function(value) return value end`,
    ...sources,
    `local response = handle()
    assert(#response.rights == 2, "both matching publishers should be returned")
    assert(response.rights[1].did == "did:plc:alice")
    assert(response.rights[2].did == "did:plc:bob")
    assert(response.rights[1].record.rightsName == "First")
    assert(response.rights[2].record.rightsName == "Second")
    assert(response.rights[1].author.profile.indexedAt == null_value)
    assert(response.rights[1].author.organization.indexedAt == null_value)
    assert(response.rights[2].author.profile.indexedAt == null_value)
    assert(response.rights[2].author.organization.indexedAt == null_value)`,
  ].join('\n\n');

  execFileSync('lua', ['-'], { input: program, encoding: 'utf8' });
});

test('listRights paginates in both directions and rejects a cursor used with another direction', async () => {
  const sources = await listRightsSources();
  const program = [
    `local null_value = {}`,
    `local records = {
      a = { rightsName = "A", createdAt = "2024-01-01T00:00:00Z" },
      b = { rightsName = "B", createdAt = "2024-01-01T00:00:00Z" },
      c = { rightsName = "C", createdAt = "2024-01-02T00:00:00Z" },
      d = { rightsName = "D", createdAt = "2024-01-03T00:00:00Z" }
    }`,
    `json = {
      decode = function(value)
        if value == "null" then return null_value end
        local version, direction, timestamp, uri = value:match('^{"v":(%d+),"d":"([^"]+)","t":"([^"]+)","u":"([^"]+)"}$')
        if version then return { v = tonumber(version), d = direction, t = timestamp, u = uri } end
        return assert(records[value], "unexpected JSON input")
      end,
      encode = function(value)
        return '{"v":' .. value.v .. ',"d":"' .. value.d .. '","t":"' .. value.t .. '","u":"' .. value.u .. '"}'
      end
    }`,
    `params = { sortDirection = "asc", limit = "2" }`,
    `local rows = {
      { uri = "at://did:plc:alice/org.hypercerts.claim.rights/a", did = "did:plc:alice", cid = "cid-a", indexed_at = "2024-01-01T00:01:00Z", record = "a", sort_timestamp = "2024-01-01T00:00:00.000000Z" },
      { uri = "at://did:plc:alice/org.hypercerts.claim.rights/b", did = "did:plc:alice", cid = "cid-b", indexed_at = "2024-01-01T00:01:00Z", record = "b", sort_timestamp = "2024-01-01T00:00:00.000000Z" },
      { uri = "at://did:plc:alice/org.hypercerts.claim.rights/c", did = "did:plc:alice", cid = "cid-c", indexed_at = "2024-01-02T00:01:00Z", record = "c", sort_timestamp = "2024-01-02T00:00:00.000000Z" },
      { uri = "at://did:plc:alice/org.hypercerts.claim.rights/d", did = "did:plc:alice", cid = "cid-d", indexed_at = "2024-01-03T00:01:00Z", record = "d", sort_timestamp = "2024-01-03T00:00:00.000000Z" }
    }`,
    `local query_count = 0
    db = {
      backend = function() return "postgres" end,
      raw = function(sql, values)
        if values[1] == "app.certified.actor.profile" or values[1] == "app.certified.actor.organization" then return {} end
        assert(values[1] == "org.hypercerts.claim.rights")
        query_count = query_count + 1
        local ascending = sql:find("ORDER BY sorted.sort_at ASC", 1, true) ~= nil
        local direction = ascending and "asc" or "desc"
        local matches = {}
        local has_cursor = sql:find("(sorted.sort_at, rights.uri)", 1, true) ~= nil
        local cursor_time, cursor_uri
        if has_cursor then
          cursor_time, cursor_uri = values[#values - 2], values[#values - 1]
        end
        for _, row in ipairs(rows) do
          local include = true
          if has_cursor then
            local later = row.sort_timestamp > cursor_time or (row.sort_timestamp == cursor_time and row.uri > cursor_uri)
            include = ascending and later or (not ascending and not later and (row.sort_timestamp ~= cursor_time or row.uri ~= cursor_uri))
          end
          if include then matches[#matches + 1] = row end
        end
        table.sort(matches, function(left, right)
          local less = left.sort_timestamp < right.sort_timestamp or
            (left.sort_timestamp == right.sort_timestamp and left.uri < right.uri)
          return ascending and less or (not ascending and not less and
            (left.sort_timestamp ~= right.sort_timestamp or left.uri ~= right.uri))
        end)
        local result = {}
        for index = 1, math.min(values[#values], #matches) do result[index] = matches[index] end
        return result
      end
    }`,
    `toarray = function(value) return value end`,
    ...sources,
    `local first_asc = handle()
    assert(#first_asc.rights == 2)
    assert(first_asc.rights[1].record.rightsName == "A" and first_asc.rights[2].record.rightsName == "B")
    assert(type(first_asc.cursor) == "string")
    local asc_cursor = first_asc.cursor
    params.cursor = asc_cursor
    local second_asc = handle()
    assert(#second_asc.rights == 2)
    assert(second_asc.rights[1].record.rightsName == "C" and second_asc.rights[2].record.rightsName == "D")
    assert(second_asc.cursor == nil, "terminal pages omit the cursor")
    local before_mismatch = query_count
    params.sortDirection = "desc"
    local mismatch_ok, mismatch_error = pcall(handle)
    assert(not mismatch_ok and tostring(mismatch_error):find("InvalidRequest", 1, true))
    assert(query_count == before_mismatch, "direction mismatch must fail before querying")
    params.cursor = nil
    local first_desc = handle()
    assert(#first_desc.rights == 2)
    assert(first_desc.rights[1].record.rightsName == "D" and first_desc.rights[2].record.rightsName == "C")
    assert(type(first_desc.cursor) == "string")
    params.cursor = first_desc.cursor
    local second_desc = handle()
    assert(#second_desc.rights == 2)
    assert(second_desc.rights[1].record.rightsName == "B" and second_desc.rights[2].record.rightsName == "A")
    assert(second_desc.cursor == nil)`,
  ].join('\n\n');

  execFileSync('lua', ['-'], { input: program, encoding: 'utf8' });
});
