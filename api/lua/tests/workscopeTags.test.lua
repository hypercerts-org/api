local TAG = "org.hypercerts.workscope.tag"
local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"
local NULL = { is_json_null = true }
local decoded_records = {}

json = {
  decode = function(value)
    if value == "null" then return NULL end
    if decoded_records[value] then return decoded_records[value] end
    if value:sub(1, 1) == "{" then
      local decoded = {
        v = tonumber(value:match('"v":(%d+)')),
        d = value:match('"d":"([^"]*)"'),
        t = value:match('"t":"([^"]*)"'),
        u = value:match('"u":"([^"]*)"'),
      }
      if decoded.v and decoded.d and decoded.t and decoded.u then return decoded end
    end
    error("unexpected test JSON: " .. value)
  end,
  encode = function(value)
    return '{"v":' .. tostring(value.v) .. ',"d":"' .. value.d ..
      '","t":"' .. value.t .. '","u":"' .. value.u .. '"}'
  end,
}

toarray = function(values) return values end
params = {}
db = { backend = function() return "postgres" end }

local did_a = "did:web:tag-a.example"
local did_b = "did:web:tag-b.example"
local author_profile_record = { ["$type"] = PROFILE, displayName = "Publisher A" }
local author_organization_record = { ["$type"] = ORGANIZATION, organizationType = { "community" } }
local tag_a_record = {
  ["$type"] = TAG,
  key = "shared_key",
  name = "Shared key from A",
  createdAt = "2025-01-02T00:00:00Z",
  parent = { uri = "at://did:web:parent.example/org.hypercerts.workscope.tag/parent", cid = "bafyreiparent" },
}
local tag_b_record = {
  ["$type"] = TAG,
  key = "shared_key",
  name = "Shared key from B",
  createdAt = "2025-01-02T00:00:00Z",
  supersededBy = { uri = "at://did:web:replacement.example/org.hypercerts.workscope.tag/next", cid = "bafyreireplacement" },
}
local older_record = {
  ["$type"] = TAG,
  key = "older_key",
  name = "Older tag",
  createdAt = "2024-12-31T23:59:59Z",
}

decoded_records["tag-a"] = tag_a_record
decoded_records["tag-b"] = tag_b_record
decoded_records["tag-older"] = older_record
decoded_records["profile-a"] = author_profile_record
decoded_records["organization-a"] = author_organization_record

local function row(uri, did, cid, record_json, indexed_at, sort_timestamp)
  return {
    uri = uri,
    did = did,
    cid = cid,
    record = record_json,
    indexed_at = indexed_at,
    sort_timestamp = sort_timestamp,
  }
end

local uri_a = "at://" .. did_a .. "/" .. TAG .. "/same-rkey"
local uri_b = "at://" .. did_b .. "/" .. TAG .. "/same-rkey"
local uri_older = "at://" .. did_a .. "/" .. TAG .. "/older"
local tag_a = row(uri_a, did_a, "bafyreitag-a", "tag-a", "2025-01-03T00:00:00Z", "2025-01-02T00:00:00.000000Z")
local tag_b = row(uri_b, did_b, "bafyreitag-b", "tag-b", "2025-01-03T00:00:00Z", "2025-01-02T00:00:00.000000Z")
local tag_older = row(uri_older, did_a, "bafyreitag-old", "tag-older", "2025-01-01T00:00:00Z", "2024-12-31T23:59:59.000000Z")
local profile_a = row("at://" .. did_a .. "/" .. PROFILE .. "/self", did_a, "bafyreiprofile", "profile-a", "2025-01-03T00:00:00Z")
local organization_a = row("at://" .. did_a .. "/" .. ORGANIZATION .. "/self", did_a, "bafyreiorganization", "organization-a", "2025-01-03T00:00:00Z")

local function reset_database()
  db.calls = {}
  db.lookup_rows = { [uri_a] = tag_a, [uri_b] = tag_b }
  db.list_rows = {}
  db.actor_rows = { [PROFILE] = { profile_a }, [ORGANIZATION] = { organization_a } }
  db.fail_collection = nil
  db.backend = function() return "postgres" end
  db.raw = function(sql, values)
    db.calls[#db.calls + 1] = { sql = sql, values = values }
    if db.fail_collection == values[1] then error("simulated database outage") end
    if sql:find("FROM happyview_records WHERE collection = $1 AND uri = $2", 1, true) then
      assert(values[1] == TAG, "exact lookup must constrain the collection")
      local found = db.lookup_rows[values[2]]
      return found and { found } or {}
    end
    if sql:find("FROM happyview_records AS workscope_tag", 1, true) then
      return db.list_rows
    end
    if sql:find("WHERE collection = $1 AND rkey = 'self'", 1, true) then
      local matches, wanted = {}, {}
      for index = 2, #values do wanted[values[index]] = true end
      for _, actor_row in ipairs(db.actor_rows[values[1]] or {}) do
        if wanted[actor_row.did] then matches[#matches + 1] = actor_row end
      end
      return matches
    end
    error("unexpected SQL: " .. sql)
  end
end

local function assert_equal(actual, expected, message)
  if actual ~= expected then
    error((message or "values differ") .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual))
  end
end

local function assert_contains(value, expected, message)
  if not value:find(expected, 1, true) then error((message or "text did not contain expected value") .. ": " .. value) end
end

local function assert_error(callback, expected)
  local ok, result = pcall(callback)
  if ok then error("expected an error containing " .. expected) end
  assert_contains(tostring(result), expected)
end

local function test(name, callback)
  local ok, message = pcall(callback)
  if not ok then error(name .. ": " .. tostring(message), 0) end
  print("ok - " .. name)
end

dofile("lua/endpoints/getWorkscopeTag.lua")
local get_workscope_tag = handle
dofile("lua/endpoints/listWorkscopeTags.lua")
local list_workscope_tags = handle

test("exact lookup preserves the record and hydrates nullable publisher sidecars", function()
  reset_database()
  params = { uri = uri_b }
  local response = get_workscope_tag()
  local view = response.workscopeTag
  assert_equal(view.uri, uri_b)
  assert_equal(view.did, did_b)
  assert_equal(view.record, tag_b_record, "record must be returned unchanged")
  assert_equal(view.record.supersededBy.uri, tag_b_record.supersededBy.uri, "references remain unexpanded")
  assert_equal(view.author.did, did_b)
  assert_equal(view.author.profile, NULL, "missing profile is JSON null")
  assert_equal(view.author.organization, NULL, "missing organization is JSON null")
  assert_contains(db.calls[1].sql, "collection = $1 AND uri = $2", "lookup must use the full URI")
  assert_equal(db.calls[1].values[2], uri_b)
end)

test("a missing exact URI returns RecordNotFound and malformed or non-tag URIs return InvalidRequest", function()
  reset_database()
  params = { uri = "at://did:web:missing.example/" .. TAG .. "/missing" }
  assert_error(get_workscope_tag, "RecordNotFound")
  params = { uri = "at://alice.example/" .. TAG .. "/same-rkey" }
  assert_error(get_workscope_tag, "InvalidRequest")
  params = { uri = "at://" .. did_a .. "/org.hypercerts.claim.activity/same-rkey" }
  assert_error(get_workscope_tag, "InvalidRequest")
  db.lookup_rows[uri_a] = row(uri_a, did_a, "bafyreitag-a", "tag-a", nil)
  params = { uri = uri_a }
  assert_error(get_workscope_tag, "WorkscopeTagQueryFailed")
end)

test("author hydration database failures surface instead of becoming null sidecars", function()
  reset_database()
  db.fail_collection = PROFILE
  params = { uri = uri_a }
  assert_error(get_workscope_tag, "WorkscopeTagQueryFailed")
end)

test("listing applies publisher OR values and stable descending keyset pagination without merging equal keys", function()
  reset_database()
  db.list_rows = { tag_b, tag_a, tag_older }
  params = { authors = { did_a, did_b, did_a }, limit = "2" }
  local first = list_workscope_tags()
  assert_equal(#first.workscopeTags, 2)
  assert_equal(first.workscopeTags[1].uri, uri_b)
  assert_equal(first.workscopeTags[2].uri, uri_a)
  assert_equal(first.workscopeTags[1].record.key, first.workscopeTags[2].record.key)
  assert_equal(first.workscopeTags[1].record, tag_b_record, "listing must preserve the full record")
  assert_equal(first.workscopeTags[1].uri == first.workscopeTags[2].uri, false, "equal keys from separate repos stay distinct")
  assert_equal(first.workscopeTags[1].author.profile, NULL)
  assert_equal(first.workscopeTags[2].author.profile.record, author_profile_record)
  assert_equal(first.workscopeTags[2].author.organization.record, author_organization_record)
  assert_equal(type(first.cursor), "string", "a next page has an opaque cursor")

  local query = db.calls[1]
  assert_contains(query.sql, "workscope_tag.did IN ($2, $3)", "authors must use OR-compatible IN filtering")
  assert_contains(query.sql, "workscope_tag.record::jsonb->>'createdAt'", "the primary sort key is the record timestamp")
  assert_contains(query.sql, "ORDER BY sorted.sort_at DESC, workscope_tag.uri DESC", "descending order uses both stable keys")
  assert_equal(query.values[2], did_a)
  assert_equal(query.values[3], did_b)
  assert_equal(query.values[4], 3, "limit+1 detects another page")

  db.calls = {}
  db.list_rows = { tag_older }
  params = { authors = { did_a, did_b }, limit = "2", cursor = first.cursor }
  local second = list_workscope_tags()
  assert_equal(#second.workscopeTags, 1)
  assert_equal(second.workscopeTags[1].uri, uri_older)
  assert_equal(second.cursor, nil, "the final page omits its cursor")
  query = db.calls[1]
  assert_contains(query.sql, ") < ((", "descending continuation uses a strict keyset boundary")
  assert_contains(query.sql, "(sorted.sort_at, workscope_tag.uri)", "cursor includes the URI tie-breaker")
  assert_equal(query.values[4], "2025-01-02T00:00:00.000000Z")
  assert_equal(query.values[5], uri_a)
end)

test("ascending order and defaults are honored and cursors are direction-bound", function()
  reset_database()
  db.list_rows = { tag_older, tag_a }
  params = { sortDirection = "asc", limit = "1" }
  local first = list_workscope_tags()
  assert_equal(first.workscopeTags[1].uri, uri_older)
  local query = db.calls[1]
  assert_contains(query.sql, "ORDER BY sorted.sort_at ASC, workscope_tag.uri ASC")
  assert_equal(query.values[#query.values], 2)

  db.calls = {}
  db.list_rows = { tag_a, tag_b }
  params = { sortDirection = "asc", limit = "1", cursor = first.cursor }
  local second = list_workscope_tags()
  assert_equal(second.workscopeTags[1].uri, uri_a)
  assert_contains(db.calls[1].sql, ") > ((", "ascending continuation uses a strict keyset boundary")
  assert_equal(db.calls[1].values[2], "2024-12-31T23:59:59.000000Z")
  assert_equal(db.calls[1].values[3], uri_older)

  db.calls = {}
  params = { sortDirection = "desc", cursor = first.cursor }
  assert_error(list_workscope_tags, "sortDirection")
  assert_equal(#db.calls, 0, "a direction-mismatched cursor is rejected before querying")

  params = {}
  db.list_rows = {}
  list_workscope_tags()
  query = db.calls[1]
  assert_contains(query.sql, "ORDER BY sorted.sort_at DESC, workscope_tag.uri DESC")
  assert_equal(query.values[#query.values], 26, "default page size is 25 with one lookahead")
end)

test("invalid list parameters are rejected before querying", function()
  reset_database()
  params = { authors = { "not-a-did" } }
  assert_error(list_workscope_tags, "InvalidRequest")
  params = { authors = {} }
  for index = 1, 101 do params.authors[index] = "did:web:author" .. index .. ".example" end
  assert_error(list_workscope_tags, "at most 100")
  params = { limit = "0" }
  assert_error(list_workscope_tags, "InvalidRequest")
  params = { extra = "no" }
  assert_error(list_workscope_tags, "unknown query parameter")
  params = { authors = { did_a }, cursor = "not-hex" }
  assert_error(list_workscope_tags, "cursor is malformed")
  assert_equal(#db.calls, 0, "invalid requests do not reach the database")
end)

print("workscope tag offline behavior tests passed")
