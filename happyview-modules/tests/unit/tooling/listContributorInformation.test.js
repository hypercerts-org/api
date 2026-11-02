import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative) => readFile(path.resolve(root, relative), 'utf8');

test('listContributorInformation filters repeated authors and resumes in the selected order', async () => {
  const sources = await Promise.all([
    read('lua/shared/query.lua'),
    read('lua/shared/didValidation.lua'),
    read('lua/shared/recordIdentifier.lua'),
    read('lua/shared/contributorInformationValidation.lua'),
    read('lua/shared/recordView.lua'),
    read('lua/shared/actorView.lua'),
    read('lua/shared/datetimeValidation.lua'),
    read('lua/shared/listValidation.lua'),
    read('lua/shared/listQuery.lua'),
    read('lua/src/listContributorInformation.lua'),
  ]);
  const program = `JSON_NULL = {}
JSON_VALUES = {}
json = {
  decode = function(value)
    if value == "null" then return JSON_NULL end
    assert(JSON_VALUES[value], "unexpected JSON fixture: " .. tostring(value))
    return JSON_VALUES[value]
  end,
  encode = function(value)
    assert(type(value) == "table" and value.v == 1, "unexpected JSON value to encode")
    JSON_VALUES.cursor = value
    return "cursor"
  end,
}
${sources.join('\n\n')}

JSON_VALUES.record1 = { ["$type"] = "org.hypercerts.claim.contributorInformation", identifier = "manual:ada", displayName = "Ada", image = { ref = "blob" } }
JSON_VALUES.record2 = { ["$type"] = "org.hypercerts.claim.contributorInformation", identifier = "manual:grace", displayName = "Grace" }
JSON_VALUES.profile = { ["$type"] = "app.certified.actor.profile", displayName = "Publisher" }
local first_uri = "at://did:plc:publisher/org.hypercerts.claim.contributorInformation/tid1"
local second_uri = "at://did:plc:publisher/org.hypercerts.claim.contributorInformation/tid2"
local first = { uri = first_uri, did = "did:plc:publisher", cid = "bafyreione", indexed_at = "2026-01-01T00:00:00Z", record = "record1", sort_timestamp = "2026-01-01T00:00:00.000000Z" }
local second = { uri = second_uri, did = "did:plc:publisher", cid = "bafyreitwo", indexed_at = "2026-01-02T00:00:00Z", record = "record2", sort_timestamp = "2026-01-02T00:00:00.000000Z" }
local profile = { uri = "at://did:plc:publisher/app.certified.actor.profile/self", did = "did:plc:publisher", cid = "bafyreiprofile", indexed_at = nil, record = "profile" }
local page = 0
local record_queries = {}
db = {
  backend = function() return "postgres" end,
  raw = function(sql, values)
    if values[1] == "org.hypercerts.claim.contributorInformation" then
      page = page + 1
      record_queries[page] = { sql = sql, values = values }
      if page == 1 then return { first, second } end
      if page == 2 then return { second } end
      return {}
    end
    if values[1] == "app.certified.actor.profile" then return { profile } end
    if values[1] == "app.certified.actor.organization" then return {} end
    error("unexpected query collection: " .. tostring(values[1]))
  end,
}
toarray = function(values) return values end
params = { authors = { "did:plc:publisher", "did:plc:other" }, sortDirection = "asc", limit = "1" }
local first_page = handle()
assert(#first_page.contributorInformation == 1)
local first_view = first_page.contributorInformation[1]
assert(first_view.uri == first_uri and first_view.did == "did:plc:publisher")
assert(first_view.record.identifier == "manual:ada" and first_view.record.displayName == "Ada")
assert(first_view.author.did == "did:plc:publisher" and first_view.author.profile.record.displayName == "Publisher")
assert(first_view.author.profile.indexedAt == JSON_NULL, "a missing profile indexed_at must serialize as JSON null")
assert(first_view.author.organization == JSON_NULL)
assert(type(first_page.cursor) == "string" and #first_page.cursor > 0)
local first_query = record_queries[1]
assert(first_query.values[1] == "org.hypercerts.claim.contributorInformation")
assert(first_query.values[2] == "did:plc:publisher" and first_query.values[3] == "did:plc:other")
assert(first_query.values[4] == 2)
assert(first_query.sql:find("contributor.did IN ($2, $3)", 1, true) ~= nil)
assert(first_query.sql:find("ORDER BY sorted.sort_at ASC, contributor.uri ASC", 1, true) ~= nil)
assert(first_query.sql:find("LIMIT $4", 1, true) ~= nil)

params = { authors = { "did:plc:publisher", "did:plc:other" }, sortDirection = "asc", limit = "1", cursor = first_page.cursor }
local second_page = handle()
assert(#second_page.contributorInformation == 1 and second_page.contributorInformation[1].uri == second_uri, "second page returned " .. tostring(#second_page.contributorInformation) .. " row(s): " .. tostring(second_page.contributorInformation[1] and second_page.contributorInformation[1].uri))
assert(second_page.cursor == nil)
local second_query = record_queries[2]
assert(second_query.values[4] == "2026-01-01T00:00:00.000000Z" and second_query.values[5] == first_uri)
assert(second_query.values[6] == 2)
assert(second_query.sql:find("(sorted.sort_at, contributor.uri) > (($4)::timestamptz, $5)", 1, true) ~= nil)
assert(first_query.sql:find("COALESCE(contributor.indexed_at::timestamptz, contributor.created_at::timestamptz)", 1, true) ~= nil)
local completed_pages = page
params = { authors = { "did:plc:publisher%GG" } }
local broad_author_result = handle()
assert(#broad_author_result.contributorInformation == 0)
assert(page == completed_pages + 1 and record_queries[page].values[2] == "did:plc:publisher%GG",
  "opaque percent sequences in a DID must reach the list query unchanged")
completed_pages = page
params = { authors = { "did:plc:publisher%2Fid" } }
local escaped_author_result = handle()
assert(#escaped_author_result.contributorInformation == 0)
assert(page == completed_pages + 1 and record_queries[page].values[2] == "did:plc:publisher%2Fid",
  "percent-escaped characters in a DID must remain accepted")
completed_pages = page
for _, invalid_author in ipairs({ "alice.example", "did:plc:publisher%" }) do
  params = { authors = { invalid_author } }
  local invalid_author_ok, invalid_author_error = pcall(function() return handle() end)
  assert(not invalid_author_ok and tostring(invalid_author_error):find("InvalidRequest:", 1, true) ~= nil)
  assert(page == completed_pages, "invalid DIDs must be rejected before querying")
end
local broad_cursor_uri = "at://did:plc:publisher%GG/org.hypercerts.claim.contributorInformation/cursor"
JSON_VALUES.cursor = { v = 1, d = "asc", t = "2026-01-03T00:00:00Z", u = broad_cursor_uri }
params = { sortDirection = "asc", limit = "1", cursor = "637572736f72" }
local broad_cursor_result = handle()
assert(#broad_cursor_result.contributorInformation == 0)
assert(page == completed_pages + 1 and record_queries[page].values[3] == broad_cursor_uri,
  "broad DID cursor URI must reach the list query unchanged")
completed_pages = page
params = { limit = "101" }
local invalid_limit_ok, invalid_limit_error = pcall(function() return handle() end)
assert(not invalid_limit_ok and tostring(invalid_limit_error) == "InvalidRequest: limit must be an integer from 1 through 100")
params = { limit = { "1", "2" } }
local repeated_limit_ok, repeated_limit_error = pcall(function() return handle() end)
assert(not repeated_limit_ok and tostring(repeated_limit_error) == "InvalidRequest: limit must occur once")
assert(page == completed_pages, "invalid list limits must be rejected before querying")
JSON_VALUES.cursor = { v = 1, d = "asc", t = "2026-01-01T00:00:00Z", u = "at://did:plc:publisher/org.hypercerts.claim.activity/tid1" }
params = { sortDirection = "asc", limit = "1", cursor = "637572736f72" }
local wrong_collection_cursor_ok, wrong_collection_cursor_error = pcall(function() return handle() end)
assert(not wrong_collection_cursor_ok and tostring(wrong_collection_cursor_error) == "InvalidRequest: cursor is malformed")
assert(page == completed_pages, "a cursor for another collection must be rejected before querying")
JSON_VALUES.cursor = { v = 1, d = "asc", t = "0000-01-01T00:00:00Z", u = first_uri }
params = { sortDirection = "asc", limit = "1", cursor = "637572736f72" }
local bad_cursor_ok, bad_cursor_error = pcall(function() return handle() end)
assert(not bad_cursor_ok and tostring(bad_cursor_error) == "InvalidRequest: cursor is malformed")
assert(page == completed_pages, "year-zero cursor must be rejected before PostgreSQL sees it")
local oversized_decoded_cursor = string.rep(" ", 4097)
JSON_VALUES[oversized_decoded_cursor] = { v = 1, d = "asc", t = "2026-01-01T00:00:00Z", u = first_uri }
params = { sortDirection = "asc", limit = "1", cursor = string.rep("20", 4097) }
local oversized_cursor_ok, oversized_cursor_error = pcall(function() return handle() end)
assert(not oversized_cursor_ok and tostring(oversized_cursor_error) == "InvalidRequest: cursor is malformed")
assert(page == completed_pages, "a cursor larger than 8192 hex characters must be rejected before decoding or querying")
`;
  const result = spawnSync('lua', ['-e', program], { encoding: 'utf8' });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
