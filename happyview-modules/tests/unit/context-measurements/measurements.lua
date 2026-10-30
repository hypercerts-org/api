local MEASUREMENT = "org.hypercerts.context.measurement"
local GET_URI = "at://did:plc:measurements.test/org.hypercerts.context.measurement/3jzfcijpj2z2a"
local URI_A = GET_URI
local URI_B = "at://did:plc:publisher-b/org.hypercerts.context.measurement/3jzfcijpj2z2b"
local URI_C = "at://did:plc:publisher-c/org.hypercerts.context.measurement/3jzfcijpj2z2c"
local SUBJECT_A = "at://did:plc:subject-a/org.hypercerts.claim.activity/3jzfcijpj2z2d"
local SUBJECT_B = "at://did:plc:subject-b/org.hypercerts.collection/3jzfcijpj2z2e"
local DID_A = "did:plc:measurements.test"
local DID_B = "did:plc:publisher-b"
local DID_C = "did:plc:publisher-c"
local NULL = { __test_json_null = true }

local measurement_a_json = [[{"$type":"org.hypercerts.context.measurement","metric":"trees planted","unit":"tree","value":"00012.3400","createdAt":"2025-01-02T03:04:05.000Z","subjects":[{"uri":"at://did:plc:subject-a/org.hypercerts.claim.activity/3jzfcijpj2z2d","cid":"bafy-old-cid"},{"uri":"at://did:plc:subject-b/org.hypercerts.collection/3jzfcijpj2z2e","cid":"bafy-another-cid"}],"locations":[{"uri":"at://did:plc:place/app.certified.location/3jzfcijpj2z2f"}],"measurers":[{"did":"did:plc:publisher-b"}]}]]
local measurement_b_json = [[{"$type":"org.hypercerts.context.measurement","metric":"water restored","unit":"litre","value":"0.0000007","createdAt":"2025-01-02T03:04:05.000Z"}]]
local measurement_c_json = [[{"$type":"org.hypercerts.context.measurement","metric":"soil carbon","unit":"tonne","value":"3.1","createdAt":"2025-01-03T00:00:00.000Z","subjects":[{"uri":"at://did:plc:subject-a/org.hypercerts.claim.activity/3jzfcijpj2z2d","cid":"bafy-current-cid"}]}]]
local measurement_d_json = [[{"$type":"org.hypercerts.context.measurement","metric":"canopy cover","unit":"percent","value":"56.2","createdAt":"2025-01-04T00:00:00.000Z","subjects":[{"uri":"at://did:plc:subject-b/org.hypercerts.collection/3jzfcijpj2z2e","cid":"bafy-other"}]}]]
local record_json = {
  [measurement_a_json] = {
    ["$type"] = MEASUREMENT,
    metric = "trees planted",
    unit = "tree",
    value = "00012.3400",
    createdAt = "2025-01-02T03:04:05.000Z",
    subjects = {
      { uri = SUBJECT_A, cid = "bafy-old-cid" },
      { uri = SUBJECT_B, cid = "bafy-another-cid" },
    },
    locations = { { uri = "at://did:plc:place/app.certified.location/3jzfcijpj2z2f" } },
    measurers = { { did = DID_B } },
  },
  [measurement_b_json] = {
    ["$type"] = MEASUREMENT,
    metric = "water restored",
    unit = "litre",
    value = "0.0000007",
    createdAt = "2025-01-02T03:04:05.000Z",
  },
  [measurement_c_json] = {
    ["$type"] = MEASUREMENT,
    metric = "soil carbon",
    unit = "tonne",
    value = "3.1",
    createdAt = "2025-01-03T00:00:00.000Z",
    subjects = { { uri = SUBJECT_A, cid = "bafy-current-cid" } },
  },
  [measurement_d_json] = {
    ["$type"] = MEASUREMENT,
    metric = "canopy cover",
    unit = "percent",
    value = "56.2",
    createdAt = "2025-01-01T00:00:00.000Z",
    subjects = { { uri = SUBJECT_B, cid = "bafy-other" } },
  },
}

local function copy_json(value)
  if type(value) ~= "table" or value == NULL then return value end
  local copy = {}
  for key, item in pairs(value) do copy[key] = copy_json(item) end
  return copy
end

json = {}
function json.decode(value)
  if value == "null" then return NULL end
  if record_json[value] then return copy_json(record_json[value]) end
  local direction, timestamp, uri = value:match(
    '^{"v":1,"d":"([^"]+)","t":"([^"]+)","u":"([^"]+)"}$')
  if direction then return { v = 1, d = direction, t = timestamp, u = uri } end
  error("test JSON decoder received an unexpected value: " .. tostring(value))
end

function json.encode(value)
  return string.format('{"v":%d,"d":"%s","t":"%s","u":"%s"}', value.v, value.d, value.t, value.u)
end

toarray = function(values) return values end
params = {}
db = { calls = {}, listRows = {}, exactRows = {}, sidecars = {}, failCollection = nil }
function db.backend() return "postgres" end
function db.raw(sql, values)
  db.calls[#db.calls + 1] = { sql = sql, values = values }
  local collection = values[1]
  if db.failCollection == collection then error("test database unavailable", 0) end
  if sql:find("WHERE collection = %$1 AND uri = %$2", 1) then
    return db.exactRows
  end
  if sql:find("WHERE collection = %$1 AND rkey = 'self'", 1) then
    return db.sidecars[collection] or {}
  end
  if sql:find("FROM happyview_records AS measurement", 1) then
    return db.listRows
  end
  error("unexpected query in measurement contract test: " .. sql)
end

local function reset_db()
  db.calls = {}
  db.listRows = {}
  db.exactRows = {}
  db.sidecars = {}
  db.failCollection = nil
end

local row_a = {
  uri = URI_A,
  cid = "bafy-measurement-a",
  indexed_at = "2025-01-03T04:00:00.000Z",
  did = DID_A,
  record = measurement_a_json,
  sort_timestamp = "2025-01-02T03:04:05.000000Z",
}
local row_b = {
  uri = URI_B,
  cid = "bafy-measurement-b",
  indexed_at = "2025-01-04T04:00:00.000Z",
  did = DID_B,
  record = measurement_b_json,
  sort_timestamp = "2025-01-02T03:04:05.000000Z",
}
local row_c = {
  uri = URI_C,
  cid = "bafy-measurement-c",
  indexed_at = "2025-01-05T04:00:00.000Z",
  did = DID_C,
  record = measurement_c_json,
  sort_timestamp = "2025-01-03T00:00:00.000000Z",
}
local row_d = {
  uri = "at://did:plc:publisher-d/org.hypercerts.context.measurement/3jzfcijpj2z2g",
  cid = "bafy-measurement-d",
  indexed_at = "2025-01-01T04:00:00.000Z",
  did = "did:plc:publisher-d",
  record = measurement_d_json,
  sort_timestamp = "2025-01-01T00:00:00.000000Z",
}

local row_missing_date = {
  uri = "at://did:plc:publisher-e/org.hypercerts.context.measurement/3jzfcijpj2z2h",
  cid = "bafy-measurement-e",
  indexed_at = "2025-02-01T00:00:00.000Z",
  created_at = "2025-03-01T00:00:00.000Z",
  did = "did:plc:publisher-e",
  record = '{"$type":"org.hypercerts.context.measurement","metric":"legacy missing date","unit":"item","value":"1"}',
  sort_timestamp = "2025-02-01T00:00:00.000000Z",
}
local row_malformed_date = {
  uri = "at://did:plc:publisher-f/org.hypercerts.context.measurement/3jzfcijpj2z2i",
  cid = "bafy-measurement-f",
  indexed_at = nil,
  created_at = "2025-02-02T00:00:00.000Z",
  did = "did:plc:publisher-f",
  record = '{"$type":"org.hypercerts.context.measurement","metric":"legacy malformed date","unit":"item","value":"2","createdAt":"not-a-timestamp"}',
  sort_timestamp = "2025-02-02T00:00:00.000000Z",
}
record_json[row_missing_date.record] = { ["$type"] = MEASUREMENT, metric = "legacy missing date", unit = "item", value = "1" }
record_json[row_malformed_date.record] = { ["$type"] = MEASUREMENT, metric = "legacy malformed date", unit = "item", value = "2", createdAt = "not-a-timestamp" }

local profile_row = {
  uri = "at://did:plc:measurements.test/app.certified.actor.profile/self",
  did = DID_A,
  cid = "bafy-profile-a",
  indexed_at = "2025-01-01T00:00:00.000Z",
  record = '{"$type":"app.certified.actor.profile","displayName":"Measurement publisher"}',
}
record_json[profile_row.record] = { ["$type"] = "app.certified.actor.profile", displayName = "Measurement publisher" }
local organization_row = {
  uri = "at://did:plc:measurements.test/app.certified.actor.organization/self",
  did = DID_A,
  cid = "bafy-organization-a",
  indexed_at = "2025-01-02T00:00:00.000Z",
  record = '{"$type":"app.certified.actor.organization","organizationType":["nonprofit"],"visibility":"public"}',
}
record_json[organization_row.record] = {
  ["$type"] = "app.certified.actor.organization",
  organizationType = { "nonprofit" },
  visibility = "public",
}

local function expect_error(callback, prefix)
  local ok, message = pcall(callback)
  assert(not ok, "expected error beginning with " .. prefix)
  assert(tostring(message):find(prefix, 1, true), "unexpected error: " .. tostring(message))
end

local function call_get(values)
  params = values
  return handle()
end

local function call_list(values)
  params = values
  return handle()
end

-- getMeasurement uses the complete AT-URI as authority and preserves the original record.
dofile("lua/endpoints/getMeasurement.lua")
reset_db()
db.exactRows = { row_a }
db.sidecars["app.certified.actor.profile"] = { profile_row }
local exact = call_get({ uri = GET_URI }).measurement
assert(exact.uri == GET_URI and exact.cid == row_a.cid and exact.did == DID_A)
assert(exact.record.value == "00012.3400", "numeric-string value must be preserved verbatim")
assert(#exact.record.subjects == 2 and exact.record.subjects[2].cid == "bafy-another-cid")
assert(exact.author.did == DID_A and exact.author.profile.record.displayName == "Measurement publisher")
assert(exact.author.profile.indexedAt == profile_row.indexed_at, "populated profile timestamps must remain unchanged")
assert(exact.author.organization == NULL, "missing organization sidecar must be nullable")
assert(db.calls[1].values[1] == MEASUREMENT and db.calls[1].values[2] == GET_URI)
assert(db.calls[1].sql:find("uri = %$2", 1) ~= nil, "lookup must compare the exact supplied URI")

reset_db()
db.exactRows = { row_a }
db.sidecars["app.certified.actor.profile"] = { profile_row }
db.sidecars["app.certified.actor.organization"] = { organization_row }
local get_with_populated_sidecars = call_get({ uri = GET_URI }).measurement
assert(get_with_populated_sidecars.author.profile.indexedAt == profile_row.indexed_at)
assert(get_with_populated_sidecars.author.organization.indexedAt == organization_row.indexed_at)

local profile_indexed_at, organization_indexed_at = profile_row.indexed_at, organization_row.indexed_at
profile_row.indexed_at, organization_row.indexed_at = nil, nil
reset_db()
db.exactRows = { row_a }
db.sidecars["app.certified.actor.profile"] = { profile_row }
db.sidecars["app.certified.actor.organization"] = { organization_row }
local get_with_nil_sidecar_timestamps = call_get({ uri = GET_URI }).measurement
assert(rawget(get_with_nil_sidecar_timestamps.author.profile, "indexedAt") == nil, "SQL-NULL profile indexedAt must be omitted")
assert(rawget(get_with_nil_sidecar_timestamps.author.organization, "indexedAt") == nil, "SQL-NULL organization indexedAt must be omitted")

profile_row.indexed_at, organization_row.indexed_at = profile_indexed_at, organization_indexed_at

local indexed_at = row_a.indexed_at
row_a.indexed_at = nil
reset_db()
db.exactRows = { row_a }
local get_without_indexed_at = call_get({ uri = GET_URI }).measurement
assert(get_without_indexed_at.indexedAt == NULL, "getMeasurement must include JSON null for a SQL NULL indexed_at")
row_a.indexed_at = indexed_at

reset_db()
expect_error(function() call_get({ uri = "at://publisher.example/org.hypercerts.context.measurement/3jzfcijpj2z2a" }) end, "InvalidRequest:")
expect_error(function() call_get({ uri = "at://did:plc:measurements.test/org.hypercerts.context.evaluation/3jzfcijpj2z2a" }) end, "InvalidRequest:")
expect_error(function() call_get({ uri = GET_URI, extra = "not allowed" }) end, "InvalidRequest:")
for _, broad_did in ipairs({ "did:plc:publisher%ZZ", "did:plc:publisher%A" }) do
  reset_db()
  db.exactRows = {}
  local broad_uri = "at://" .. broad_did .. "/org.hypercerts.context.measurement/3jzfcijpj2z2a"
  expect_error(function() call_get({ uri = broad_uri }) end, "RecordNotFound:")
  assert(#db.calls == 1 and db.calls[1].values[2] == broad_uri, "broad DID syntax must reach exact lookup unchanged")
end
reset_db()
expect_error(function()
  call_get({ uri = "at://did:plc:publisher%/org.hypercerts.context.measurement/3jzfcijpj2z2a" })
end, "InvalidRequest:")
assert(#db.calls == 0, "a trailing percent remains an invalid DID boundary")
reset_db()
expect_error(function() call_get({ uri = GET_URI }) end, "RecordNotFound:")
reset_db()
db.exactRows = { row_a }
db.failCollection = "app.certified.actor.profile"
expect_error(function() call_get({ uri = GET_URI }) end, "test database unavailable")

-- listMeasurements includes subjectless rows without filters and defaults to a 25-item descending page.
dofile("lua/endpoints/listMeasurements.lua")
reset_db()
db.listRows = { row_a }
db.sidecars["app.certified.actor.profile"] = { profile_row }
db.sidecars["app.certified.actor.organization"] = { organization_row }
local list_with_populated_sidecars = call_list({}).measurements[1]
assert(list_with_populated_sidecars.author.profile.indexedAt == profile_indexed_at)
assert(list_with_populated_sidecars.author.organization.indexedAt == organization_indexed_at)

profile_row.indexed_at, organization_row.indexed_at = nil, nil
reset_db()
db.listRows = { row_a }
db.sidecars["app.certified.actor.profile"] = { profile_row }
db.sidecars["app.certified.actor.organization"] = { organization_row }
local list_with_nil_sidecar_timestamps = call_list({}).measurements[1]
assert(rawget(list_with_nil_sidecar_timestamps.author.profile, "indexedAt") == nil, "listMeasurements must omit SQL-NULL profile indexedAt")
assert(rawget(list_with_nil_sidecar_timestamps.author.organization, "indexedAt") == nil, "listMeasurements must omit SQL-NULL organization indexedAt")
profile_row.indexed_at, organization_row.indexed_at = profile_indexed_at, organization_indexed_at

for _, broad_did in ipairs({ "did:plc:publisher%ZZ", "did:plc:publisher%A" }) do
  for _, filters in ipairs({
    { authors = { broad_did } },
    { subjects = { "at://" .. broad_did .. "/org.hypercerts.claim.activity/3jzfcijpj2z2d" } },
  }) do
    reset_db()
    db.listRows = {}
    assert(#call_list(filters).measurements == 0)
    local query = db.calls[1]
    assert(query ~= nil, "broad DID list filters must reach SQL")
    assert(query.values[2] == (filters.authors and broad_did or filters.subjects[1]),
      "broad DID filter values must reach SQL unchanged")
  end
end

-- Well-formed percent escapes remain valid DIDs after using the generic validator.
reset_db()
db.listRows = { row_a }
local escaped_author = "did:plc:publisher%20one"
assert(#call_list({ authors = { escaped_author } }).measurements == 1)
assert(db.calls[1].values[2] == escaped_author, "valid DID escapes must remain a bound author value")

-- Measurement subject URIs still require a syntactically valid collection NSID.
reset_db()
expect_error(function() call_list({ subjects = { "at://did:plc:subject-a/invalid/3jzfcijpj2z2d" } }) end, "InvalidRequest:")
assert(#db.calls == 0, "invalid collection NSID must be rejected before SQL")

reset_db()
db.listRows = { row_c, row_b }
local global = call_list({})
assert(#global.measurements == 2, "unfiltered results include every measurement, including subjectless records")
assert(global.measurements[2].record.subjects == nil, "subjectless record must remain in the global result")
local global_query = db.calls[1]
assert(global_query.values[1] == MEASUREMENT and global_query.values[#global_query.values] == 26)
assert(not global_query.sql:find("jsonb_array_elements", 1, true), "no subject filter should not exclude subjectless rows")
assert(global_query.sql:find("ORDER BY sorted.sort_at DESC, measurement.uri DESC", 1, true))

-- Legacy records sort by a valid createdAt, then indexed_at, then the stored row creation time.
reset_db()
db.listRows = { row_missing_date, row_malformed_date }
local fallback_ascending = call_list({ sortDirection = "asc", limit = "1" })
assert(fallback_ascending.measurements[1].record.createdAt == nil, "missing createdAt must remain missing in the source record")
assert(fallback_ascending.measurements[1].indexedAt == row_missing_date.indexed_at)
assert(fallback_ascending.cursor ~= nil)
local fallback_sql = db.calls[1].sql
local input_check = fallback_sql:find("pg_input_is_valid", 1, true)
local guarded_cast = fallback_sql:find("THEN (measurement.record::jsonb->>'createdAt')::timestamptz", 1, true)
assert(input_check and guarded_cast and input_check < guarded_cast, "untrusted createdAt must be validated before casting")
assert(fallback_sql:find("ELSE COALESCE(measurement.indexed_at::timestamptz, measurement.created_at::timestamptz) END", 1, true))
assert(fallback_sql:find("ORDER BY sorted.sort_at ASC, measurement.uri ASC", 1, true))

reset_db()
db.listRows = { row_malformed_date }
local fallback_ascending_next = call_list({ sortDirection = "asc", limit = "1", cursor = fallback_ascending.cursor })
assert(fallback_ascending_next.measurements[1].record.createdAt == "not-a-timestamp", "malformed source date must not be rewritten")
assert(fallback_ascending_next.measurements[1].indexedAt == NULL, "listMeasurements must include JSON null for SQL NULL indexed_at")
assert(db.calls[1].sql:find("(sorted.sort_at, measurement.uri) > (($2)::timestamptz, $3)", 1, true))
assert(db.calls[1].values[2] == row_missing_date.sort_timestamp and db.calls[1].values[3] == row_missing_date.uri)

reset_db()
db.listRows = { row_malformed_date, row_missing_date }
local fallback_descending = call_list({ sortDirection = "desc", limit = "1" })
assert(fallback_descending.measurements[1].record.createdAt == "not-a-timestamp")
assert(fallback_descending.cursor ~= nil)
reset_db()
db.listRows = { row_missing_date }
call_list({ sortDirection = "desc", limit = "1", cursor = fallback_descending.cursor })
assert(db.calls[1].sql:find("ORDER BY sorted.sort_at DESC, measurement.uri DESC", 1, true))
assert(db.calls[1].sql:find("(sorted.sort_at, measurement.uri) < (($2)::timestamptz, $3)", 1, true))
assert(db.calls[1].values[2] == row_malformed_date.sort_timestamp and db.calls[1].values[3] == row_malformed_date.uri)

-- Filters use repository DID and any subject URI, with OR within arrays and AND between them.
reset_db()
db.listRows = { row_c, row_b, row_a }
local filtered = call_list({
  authors = { DID_A, DID_B, DID_A },
  subjects = { SUBJECT_A, SUBJECT_B, SUBJECT_A },
  sortDirection = "asc",
  limit = "2",
})
assert(#filtered.measurements == 2)
local filter_query = db.calls[1]
local sql, values = filter_query.sql, filter_query.values
assert(sql:find("measurement.did IN ($2, $3)", 1, true), "author filter must match repository owners and deduplicate OR values")
assert(sql:find("jsonb_array_elements", 1, true), "subject filter must inspect every subjects[] entry")
assert(sql:find("subject.value->>'uri' IN ($4, $5)", 1, true), "subject values must use OR and compare URI only")
assert(not sql:find("measurers", 1, true), "authors must not match named measurers")
assert(not sql:find("->>'cid'", 1, true), "subject matching must not compare CID")
assert(sql:find("measurement.did IN ($2, $3)", 1, true) < sql:find("jsonb_array_elements", 1, true), "distinct filters must both constrain one query")
assert(values[1] == MEASUREMENT and values[2] == DID_A and values[3] == DID_B)
assert(values[4] == SUBJECT_A and values[5] == SUBJECT_B and values[6] == 3)
assert(sql:find("ORDER BY sorted.sort_at ASC, measurement.uri ASC", 1, true))
assert(type(filtered.cursor) == "string" and #filtered.cursor > 0, "overfetch must return an opaque next-page cursor")

local function unhex(value)
  return (value:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end))
end
local cursor_payload = json.decode(unhex(filtered.cursor))
assert(cursor_payload.v == 1 and cursor_payload.d == "asc")
assert(cursor_payload.t == row_b.sort_timestamp and cursor_payload.u == row_b.uri)

-- Cursor direction is bound; a valid cursor continues after the last returned (createdAt, uri) tuple.
reset_db()
expect_error(function() call_list({ cursor = filtered.cursor, sortDirection = "desc" }) end, "InvalidRequest:")
assert(#db.calls == 0, "direction mismatch must be rejected before querying")
reset_db()
db.listRows = { row_a }
local continued = call_list({
  authors = { DID_A, DID_B, DID_A },
  subjects = { SUBJECT_A, SUBJECT_B, SUBJECT_A },
  sortDirection = "asc",
  limit = "2",
  cursor = filtered.cursor,
})
assert(#continued.measurements == 1 and continued.cursor == nil)
local continuation_query = db.calls[1]
assert(continuation_query.sql:find("(sorted.sort_at, measurement.uri) > (($6)::timestamptz, $7)", 1, true))
assert(continuation_query.values[6] == row_b.sort_timestamp and continuation_query.values[7] == row_b.uri)

-- Repeated-value and scalar validation protects bounds and avoids issuing malformed database queries.
reset_db()
local too_many = {}
for index = 1, 101 do too_many[index] = "did:plc:publisher-" .. index end
expect_error(function() call_list({ authors = too_many }) end, "InvalidRequest:")
expect_error(function() call_list({ limit = "101" }) end, "InvalidRequest:")
expect_error(function() call_list({ limit = { "2", "3" } }) end, "InvalidRequest:")
expect_error(function() call_list({ unexpected = "value" }) end, "InvalidRequest:")
expect_error(function() call_list({ cursor = "not-a-cursor" }) end, "InvalidRequest:")
local year_zero_json = json.encode({ v = 1, d = "asc", t = "0000-01-01T00:00:00.000000Z", u = GET_URI })
local year_zero_cursor = year_zero_json:gsub(".", function(char) return string.format("%02x", string.byte(char)) end)
expect_error(function() call_list({ sortDirection = "asc", cursor = year_zero_cursor }) end, "InvalidRequest:")
assert(#db.calls == 0, "year-zero cursor must be rejected before SQL")
local broad_cursor_uri = "at://did:plc:publisher%ZZ/org.hypercerts.context.measurement/3jzfcijpj2z2a"
local broad_cursor_json = json.encode({
  v = 1,
  d = "asc",
  t = "2025-01-01T00:00:00.000000Z",
  u = broad_cursor_uri,
})
local broad_cursor = broad_cursor_json:gsub(".", function(char) return string.format("%02x", string.byte(char)) end)
reset_db()
db.listRows = {}
call_list({ sortDirection = "asc", cursor = broad_cursor })
assert(#db.calls == 1 and db.calls[1].values[3] == broad_cursor_uri,
  "cursor URI with a broad DID must reach the list query unchanged")

reset_db()
expect_error(function() call_list({ authors = { "did:plc:publisher%" } }) end, "InvalidRequest:")
assert(#db.calls == 0, "trailing percent remains invalid before SQL")

print("measurement behavior contracts passed")
