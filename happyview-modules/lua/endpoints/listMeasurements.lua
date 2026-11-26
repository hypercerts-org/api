local function invalid(message)
  error("InvalidRequest: " .. message, 0)
end

local function keys_only(values, allowed, unknown_message_prefix)
  for key in pairs(values) do
    if not allowed[key] then
      invalid(unknown_message_prefix and (unknown_message_prefix .. key) or "unknown query parameter")
    end
  end
end

local function scalar(params, key)
  local value = params[key]
  if value == nil then return nil end
  if type(value) ~= "string" and type(value) ~= "number" then
    invalid(key .. " must occur once")
  end
  return tostring(value)
end

-- luacheck: push ignore 211
-- Like scalar(), but a boolean comes back as "true" or "false": HappyView can hand
-- boolean-typed query parameters to Lua as booleans rather than strings.
local function scalar_or_boolean(values, key)
  if type(values[key]) == "boolean" then return tostring(values[key]) end
  return scalar(values, key)
end
-- luacheck: pop

-- Reads a repeated query parameter (?key=a&key=b) as a list of strings, or nil when absent.
-- A single value counts as a list of one. Rejects non-string entries, keyed or sparse
-- tables and more than 100 values. Item rules stay with the caller so each endpoint keeps
-- its own error messages; see unique_query_values.
local function query_string_values(params, key)
  local value = params[key]
  if value == nil then return nil end
  if type(value) == "string" then return { value } end
  if type(value) ~= "table" then
    invalid(key .. " must be a string or repeated string parameter")
  end
  local count = 0
  for index in pairs(value) do
    if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
      invalid(key .. " must use repeated query values")
    end
    count = count + 1
  end
  if count ~= #value then invalid(key .. " must use repeated query values") end
  local values = {}
  for index = 1, count do
    if type(value[index]) ~= "string" then invalid(key .. " entries must be strings") end
    values[index] = value[index]
  end
  if #values > 100 then invalid(key .. " accepts at most 100 values") end
  return values
end

-- Runs check(item, index) on every value in order, then returns the distinct results in
-- first-seen order. check raises its own error for a bad item and may return a normalized
-- replacement; returning nothing keeps the item.
local function unique_query_values(values, check)
  local unique, seen = {}, {}
  for index, item in ipairs(values) do
    local value = check and check(item, index) or item
    if not seen[value] then
      seen[value] = true
      unique[#unique + 1] = value
    end
  end
  return unique
end

local function valid_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
end

local function valid_record_key(value)
  return #value >= 1 and #value <= 512 and value ~= "." and value ~= ".."
    and not value:find("[^%w_~%.:%-]")
end

local function valid_record_uri(value)
  if type(value) ~= "string" or value:find("[?#]") then return false end
  local authority, collection, rkey = value:match("^at://([^/]+)/([^/]+)/([^/]+)$")
  if not authority or not valid_did(authority) or not valid_record_key(rkey) then return false end
  return true, collection, authority
end

-- luacheck: push ignore 211
-- For user-supplied filter values: bounds the size before parsing.
local function valid_bounded_record_uri(value)
  if type(value) ~= "string" or #value > 8192 then return false end
  return valid_record_uri(value)
end
-- luacheck: pop

local function valid_datetime(value)
  if type(value) ~= "string" then return false end
  local year, month, day, hour, minute, second, suffix = value:match(
    "^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)(.*)$")
  if not year then return false end
  year, month, day = tonumber(year), tonumber(month), tonumber(day)
  if year < 1 then return false end
  hour, minute, second = tonumber(hour), tonumber(minute), tonumber(second)
  if month < 1 or month > 12 or hour > 23 or minute > 59 or second > 59 then return false end
  local leap = year % 4 == 0 and (year % 100 ~= 0 or year % 400 == 0)
  local month_days = { 31, leap and 29 or 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 }
  if day < 1 or day > month_days[month] then return false end
  local fraction, zone = suffix:match("^(%.%d+)(Z)$")
  if not fraction then fraction, zone = suffix:match("^(%.%d+)([+-]%d%d:%d%d)$") end
  if not fraction then zone = suffix:match("^(Z)$") end
  if not zone then zone = suffix:match("^([+-]%d%d:%d%d)$") end
  if not zone or zone == "-00:00" then return false end
  if zone ~= "Z" then
    local zh, zm = zone:match("^[+-](%d%d):(%d%d)$")
    if not zh or tonumber(zh) > 23 or tonumber(zm) > 59 then return false end
  end
  return true
end

local function parse_list_limit(params)
  local limit_value = scalar(params, "limit")
  if limit_value and not limit_value:match("^%d+$") then invalid("limit must be an integer from 1 through 100") end
  local limit = limit_value and tonumber(limit_value) or 25
  if not limit or limit % 1 ~= 0 or limit < 1 or limit > 100 then invalid("limit must be an integer from 1 through 100") end
  return limit
end

-- The hex prologue every list cursor shape shares: rejects empty, over-long (8192),
-- odd-length and non-lowercase-hex tokens with "cursor is malformed" and returns the
-- decoded JSON text. Shape and JSON checks stay with each cursor's own decoder.
local function decode_hex_cursor_token(token)
  if #token == 0 or #token > 8192 or #token % 2 ~= 0 or token:find("[^0-9a-f]") then
    invalid("cursor is malformed")
  end
  return (token:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end))
end

-- Hex-encodes the JSON of a cursor table.
local function cursor_encode(value)
  local encoded = json.encode(value)
  return (encoded:gsub(".", function(char) return string.format("%02x", string.byte(char)) end))
end

-- luacheck: push ignore 211
-- Decodes a hex-encoded {v, d, t, u} list cursor. Rejects malformed tokens, other
-- sort directions and unknown keys; validate_value(value) -> boolean runs the
-- endpoint-specific check on t and u. Not for endpoints that skip the 8192-character
-- cap or accept extra keys.
local function decode_cursor(token, direction, validate_value)
  if token == nil then return nil end
  local decoded = decode_hex_cursor_token(token)
  local ok, value = pcall(json.decode, decoded)
  if not ok or type(value) ~= "table" or value.v ~= 1 or value.d ~= direction
    or type(value.t) ~= "string" or type(value.u) ~= "string" then
    invalid("cursor is malformed or belongs to another sortDirection")
  end
  for key in pairs(value) do
    if key ~= "v" and key ~= "d" and key ~= "t" and key ~= "u" then invalid("cursor is malformed") end
  end
  if not validate_value(value) then invalid("cursor is malformed") end
  return value
end

-- decode_cursor for the common case: t is a datetime and u a record URI.
-- record_uri is the collection NSID u must belong to, or a predicate(uri) -> boolean
-- for endpoints with stricter URI rules. valid_t(t) defaults to valid_datetime.
local function decode_record_cursor(token, direction, record_uri, valid_t)
  valid_t = valid_t or valid_datetime
  return decode_cursor(token, direction, function(value)
    if not valid_t(value.t) then return false end
    if type(record_uri) == "function" then return record_uri(value.u) end
    local valid, collection = valid_record_uri(value.u)
    return valid and collection == record_uri
  end)
end
-- luacheck: pop

local function parse_sort_direction(params)
  local direction = scalar(params, "sortDirection") or "desc"
  if direction ~= "asc" and direction ~= "desc" then invalid("sortDirection must be 'asc' or 'desc'") end
  return direction
end

local NULL = json.decode("null")

local function record_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and NULL or row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end

-- luacheck: push ignore 211
-- Like record_view, but a row without indexed_at has no indexedAt key instead of JSON null.
-- Pass it to hydrate_actor_views for sidecars that preserve the omission.
local function record_view_omitting_indexed_at(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end
-- luacheck: pop

local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"

-- view(row) builds each profile/organization sidecar; it defaults to record_view.
local function hydrate_actor_views(actors, run_query, view)
  view = view or record_view
  if #actors == 0 then return end
  local dids, seen = {}, {}
  for _, actor in ipairs(actors) do
    if not seen[actor.did] then
      seen[actor.did] = true
      dids[#dids + 1] = actor.did
    end
  end
  local profiles, organizations = {}, {}
  local function load(collection, target)
    local params, marks = { collection }, {}
    for _, did in ipairs(dids) do
      params[#params + 1] = did
      marks[#marks + 1] = "$" .. #params
    end
    local rows = run_query("SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(marks, ",") .. ")", params)
    for _, row in ipairs(rows) do target[row.did] = row end
  end
  load(PROFILE, profiles)
  load(ORGANIZATION, organizations)
  for _, actor in ipairs(actors) do
    actor.profile = profiles[actor.did] and view(profiles[actor.did]) or NULL
    actor.organization = organizations[actor.did] and view(organizations[actor.did]) or NULL
  end
end

local MEASUREMENT = "org.hypercerts.context.measurement"
local MEASUREMENT_NULL = json.decode("null")

local function measurement_query(sql, values)
  if db.backend() ~= "postgres" then
    error("MeasurementQueryFailed: measurement queries require PostgreSQL", 0)
  end
  local rows = db.raw(sql, values)
  if type(rows) ~= "table" then
    error("MeasurementQueryFailed: database returned an invalid result", 0)
  end
  return rows
end

local function measurement_view(row)
  local view = record_view(row)
  if row.indexed_at == nil then view.indexedAt = MEASUREMENT_NULL end
  view.author = { did = row.did }
  return view
end

local function omit_null_sidecar_indexed_at(sidecar)
  if type(sidecar) == "table" and sidecar.indexedAt == MEASUREMENT_NULL then
    sidecar.indexedAt = nil
  end
end

local function hydrate_measurement_views(views)
  local authors = {}
  for _, view in ipairs(views) do authors[#authors + 1] = view.author end
  hydrate_actor_views(authors, measurement_query)
  -- Measurement sidecars historically omitted SQL-NULL timestamps; top-level views retain JSON null.
  for _, author in ipairs(authors) do
    omit_null_sidecar_indexed_at(author.profile)
    omit_null_sidecar_indexed_at(author.organization)
  end
end

-- An atproto NSID: at least three dot-separated segments, at most 317 characters.
local function valid_nsid(value)
  if type(value) ~= "string" or #value > 317 then return false end
  local segments = {}
  for segment in value:gmatch("[^%.]+") do segments[#segments + 1] = segment end
  if #segments < 3 or table.concat(segments, ".") ~= value then return false end
  for index = 1, #segments - 1 do
    local segment = segments[index]
    if #segment > 63 or segment:find("[^A-Za-z0-9%-]") then return false end
    local first, last = segment:sub(1, 1), segment:sub(-1)
    if not first:match(index == 1 and "^[A-Za-z]$" or "^[A-Za-z0-9]$")
      or not last:match("^[A-Za-z0-9]$") then return false end
  end
  local name = segments[#segments]
  return #name <= 63 and name:match("^[A-Za-z][A-Za-z0-9]*$") ~= nil
end

-- Appends each item to binds and returns its "$n" placeholders, in order.
local function bind_values(binds, items)
  local placeholders = {}
  for _, item in ipairs(items) do
    binds[#binds + 1] = item
    placeholders[#placeholders + 1] = "$" .. #binds
  end
  return placeholders
end

-- Adds `column IN ($n, ...)` to where, binding items; an empty list matches nothing.
local function add_in(where, binds, column, items)
  if #items == 0 then
    where[#where + 1] = "FALSE"
    return
  end
  where[#where + 1] = column .. " IN (" .. table.concat(bind_values(binds, items), ", ") .. ")"
end

local CREATED_AT_SORT_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"

-- Sort key for a happyview_records row: the record's own createdAt when it is a
-- valid timestamp, otherwise COALESCE(indexed_at, created_at). `alias` is the
-- table alias; nil selects unqualified columns.
local function created_at_sort(alias)
  local prefix = alias and (alias .. ".") or ""
  local record, indexed_at, created_at = prefix .. "record", prefix .. "indexed_at", prefix .. "created_at"
  local created = record .. "::jsonb->>'createdAt'"
  return "CASE WHEN jsonb_typeof(" .. record .. "::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. CREATED_AT_SORT_PATTERN .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE COALESCE(" .. indexed_at ..
    "::timestamptz, " .. created_at .. "::timestamptz) END"
end

local function measurement_filter_values(key, format)
  local supplied = query_string_values(params, key)
  if not supplied then return nil end
  return unique_query_values(supplied, function(item)
    if format == "did" and not valid_did(item) then
      invalid("each " .. key .. " value must be a valid DID")
    elseif format == "at-uri" then
      local valid, collection = valid_record_uri(item)
      if not valid or not valid_nsid(collection) then
        invalid("each " .. key .. " value must be a full AT-URI with a DID authority and valid collection NSID")
      end
    end
  end)
end

local function measurement_list_query(authors, subjects, limit, cursor, direction)
  local where, values = { "measurement.collection = $1" }, { MEASUREMENT }
  if authors then add_in(where, values, "measurement.did", authors) end
  if subjects then
    if #subjects == 0 then
      where[#where + 1] = "FALSE"
    else
      local source = "CASE WHEN jsonb_typeof(measurement.record::jsonb->'subjects') = 'array' " ..
        "THEN measurement.record::jsonb->'subjects' ELSE '[]'::jsonb END"
      local placeholders = bind_values(values, subjects)
      where[#where + 1] = "EXISTS (SELECT 1 FROM jsonb_array_elements(" .. source .. ") AS subject(value) " ..
        "WHERE subject.value->>'uri' IN (" .. table.concat(placeholders, ", ") .. "))"
    end
  end

  local page_values, page_where = {}, {}
  for _, value in ipairs(values) do page_values[#page_values + 1] = value end
  for _, clause in ipairs(where) do page_where[#page_where + 1] = clause end
  if cursor then
    page_values[#page_values + 1] = cursor.t
    local timestamp = "$" .. #page_values
    page_values[#page_values + 1] = cursor.u
    local uri = "$" .. #page_values
    local operator = direction == "asc" and ">" or "<"
    page_where[#page_where + 1] = "(sorted.sort_at, measurement.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  page_values[#page_values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT measurement.uri, measurement.did, measurement.cid, " ..
    "measurement.indexed_at::text AS indexed_at, measurement.record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS measurement CROSS JOIN LATERAL (SELECT " ..
    created_at_sort("measurement") .. " AS sort_at) AS sorted WHERE " .. table.concat(page_where, " AND ") ..
    " ORDER BY sorted.sort_at " .. ordering .. ", measurement.uri " .. ordering .. " LIMIT $" .. #page_values
  local rows = measurement_query(sql, page_values)

  local measurements = {}
  local included = math.min(#rows, limit)
  for index = 1, included do measurements[#measurements + 1] = measurement_view(rows[index]) end

  local next_cursor
  if #rows > limit then
    local last = rows[limit]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  hydrate_measurement_views(measurements)
  return measurements, next_cursor
end

function handle()
  keys_only(params, {
    authors = true,
    subjects = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  })

  local authors = measurement_filter_values("authors", "did")
  local subjects = measurement_filter_values("subjects", "at-uri")
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, MEASUREMENT)
  local measurements, next_cursor = measurement_list_query(authors, subjects, limit, cursor, direction)

  local response = { measurements = toarray(measurements) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
