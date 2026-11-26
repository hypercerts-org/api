local function valid_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
end

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

-- Hex-encodes the JSON of a cursor table.
local function cursor_encode(value)
  local encoded = json.encode(value)
  return (encoded:gsub(".", function(char) return string.format("%02x", string.byte(char)) end))
end

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

local WORKSCOPE_TAG = "org.hypercerts.workscope.tag"
local WORKSCOPE_TAG_NULL = json.decode("null")

local function workscope_tag_query(sql, values)
  if db.backend() ~= "postgres" then
    error("WorkscopeTagQueryFailed: workscope-tag API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("WorkscopeTagQueryFailed: work-scope tag query failed", 0)
  end
  return result
end

local function workscope_tag_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and WORKSCOPE_TAG_NULL or row.indexed_at,
    did = row.did,
    author = { did = row.did },
    record = json.decode(row.record),
  }
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

-- Adds `column IN ($n, ...)` to where, binding items; an empty list matches nothing.
local function add_in(where, binds, column, items)
  if #items == 0 then
    where[#where + 1] = "FALSE"
    return
  end
  local marks = {}
  for _, item in ipairs(items) do
    binds[#binds + 1] = item
    marks[#marks + 1] = "$" .. #binds
  end
  where[#where + 1] = column .. " IN (" .. table.concat(marks, ", ") .. ")"
end

local function workscope_tag_array(key)
  local value = params[key]
  if value == nil then return nil end

  local supplied = {}
  if type(value) == "string" then
    supplied[1] = value
  elseif type(value) == "table" then
    local count = 0
    for index in pairs(value) do
      if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
        invalid(key .. " must use repeated query values")
      end
      count = count + 1
    end
    if count ~= #value then invalid(key .. " must use repeated query values") end
    for index = 1, count do
      if type(value[index]) ~= "string" then invalid(key .. " entries must be strings") end
      supplied[#supplied + 1] = value[index]
    end
  else
    invalid(key .. " must be a string or repeated string parameter")
  end
  if #supplied > 100 then invalid(key .. " accepts at most 100 values") end

  local unique, seen = {}, {}
  for _, did in ipairs(supplied) do
    if not valid_did(did) then
      invalid("each " .. key .. " value must be a valid DID; resolve handles to DIDs first")
    end
    if not seen[did] then
      seen[did] = true
      unique[#unique + 1] = did
    end
  end
  return unique
end

local function workscope_tag_list()
  keys_only(params, { authors = true, sortDirection = true, limit = true, cursor = true })
  local authors = workscope_tag_array("authors")
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, WORKSCOPE_TAG)

  local where, values = { "workscope_tag.collection = $1" }, { WORKSCOPE_TAG }
  if authors then add_in(where, values, "workscope_tag.did", authors) end
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, workscope_tag.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  local ordering = direction == "asc" and "ASC" or "DESC"
  values[#values + 1] = limit + 1
  local created_at = "workscope_tag.record::jsonb->>'createdAt'"
  local valid_zoned_created_at = created_at .. " ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' AND " ..
    created_at .. " !~ '-00:00$' AND pg_input_is_valid(" .. created_at .. ", 'timestamp with time zone')"
  local indexed_at = "workscope_tag.indexed_at"
  local row_created_at = "workscope_tag.created_at"
  local function timestamp_fallback(column)
    return "CASE WHEN pg_input_is_valid(" .. column .. ", 'timestamp with time zone') THEN " .. column .. "::timestamptz END"
  end
  local sort_at = "COALESCE(CASE WHEN " .. valid_zoned_created_at .. " THEN (" .. created_at ..
    ")::timestamptz END, " .. timestamp_fallback(indexed_at) .. ", " .. timestamp_fallback(row_created_at) .. ")"
  local sql = "SELECT workscope_tag.uri, workscope_tag.did, workscope_tag.cid, " ..
    "workscope_tag.indexed_at::text AS indexed_at, workscope_tag.record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS workscope_tag CROSS JOIN LATERAL (SELECT " .. sort_at ..
    " AS sort_at) AS sorted WHERE " .. table.concat(where, " AND ") ..
    " ORDER BY sorted.sort_at " .. ordering .. ", workscope_tag.uri " .. ordering .. " LIMIT $" .. #values
  local rows = workscope_tag_query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local views = {}
  local authors_to_hydrate = {}
  for _, row in ipairs(rows) do
    local view = workscope_tag_view(row)
    views[#views + 1] = view
    authors_to_hydrate[#authors_to_hydrate + 1] = view.author
  end
  hydrate_actor_views(authors_to_hydrate, workscope_tag_query, record_view_omitting_indexed_at)

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end

function handle()
  local workscope_tags, cursor = workscope_tag_list()
  local response = { workscopeTags = toarray(workscope_tags) }
  if cursor then response.cursor = cursor end
  return response
end
