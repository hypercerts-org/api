local ACKNOWLEDGEMENT = "org.hypercerts.context.acknowledgement"
local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"
local NULL = json.decode("null")

local function invalid(message)
  error("InvalidRequest: " .. message, 0)
end

local function keys_only(values, allowed)
  for key in pairs(values) do
    if not allowed[key] then invalid("unknown query parameter") end
  end
end

local function scalar(values, key)
  local value = values[key]
  if value == nil then return nil end
  if type(value) ~= "string" and type(value) ~= "number" then
    invalid(key .. " must occur once")
  end
  return tostring(value)
end

local function valid_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  local position = 1
  while true do
    local percent = value:find("%", position, true)
    if not percent then break end
    local escape = value:sub(percent + 1, percent + 2)
    if #escape ~= 2 or escape:find("[^0-9A-Fa-f]") then return false end
    position = percent + 3
  end
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
  return true, collection
end

local function acknowledgement_query(sql, values)
  if db.backend() ~= "postgres" then
    error("AcknowledgementQueryFailed: acknowledgement API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("AcknowledgementQueryFailed: indexed record or publisher lookup failed", 0)
  end
  return result
end

local function acknowledgement_record_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at or NULL,
    did = row.did,
    record = json.decode(row.record),
  }
end

local function hydrate_acknowledgement_authors(views)
  local dids, seen = {}, {}
  for _, view in ipairs(views) do
    if not seen[view.did] then
      seen[view.did] = true
      dids[#dids + 1] = view.did
    end
  end
  if #dids == 0 then return end

  local profiles, organizations = {}, {}
  local function load(collection, target)
    local values, marks = { collection }, {}
    for _, did in ipairs(dids) do
      values[#values + 1] = did
      marks[#marks + 1] = "$" .. #values
    end
    local rows = acknowledgement_query(
      "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
        "FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(marks, ",") .. ")",
      values)
    for _, row in ipairs(rows) do target[row.did] = row end
  end
  load(PROFILE, profiles)
  load(ORGANIZATION, organizations)
  for _, view in ipairs(views) do
    view.author = {
      did = view.did,
      profile = profiles[view.did] and acknowledgement_record_view(profiles[view.did]) or NULL,
      organization = organizations[view.did] and acknowledgement_record_view(organizations[view.did]) or NULL,
    }
  end
end

local function valid_datetime(value)
  local year, month, day, hour, minute, second, suffix = value:match(
    "^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)(.*)$")
  if not year then return false end
  year, month, day = tonumber(year), tonumber(month), tonumber(day)
  hour, minute, second = tonumber(hour), tonumber(minute), tonumber(second)
  if year < 1 or month < 1 or month > 12 or hour > 23 or minute > 59 or second > 59 then return false end
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

local function valid_cursor_timestamp(value)
  if type(value) ~= "string" or #value ~= 27
    or not value:match("^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%d%.%d%d%d%d%d%dZ$") then
    return false
  end
  return valid_datetime(value)
end

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

local function acknowledgement_array(key, format)
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
  for _, item in ipairs(supplied) do
    if format == "did" and not valid_did(item) then
      invalid("each " .. key .. " value must be a valid DID; resolve handles to DIDs first")
    elseif format == "at-uri" then
      local valid, collection = valid_record_uri(item)
      if not valid or not valid_nsid(collection) then
        invalid("each " .. key .. " value must be a full AT-URI with a DID authority and valid collection NSID")
      end
    end
    if not seen[item] then
      seen[item] = true
      unique[#unique + 1] = item
    end
  end
  return unique
end

local function bind_acknowledgement_values(values, items)
  local placeholders = {}
  for _, item in ipairs(items) do
    values[#values + 1] = item
    placeholders[#placeholders + 1] = "$" .. #values
  end
  return placeholders
end

local function cursor_encode(value)
  local encoded = json.encode(value)
  return (encoded:gsub(".", function(char) return string.format("%02x", string.byte(char)) end))
end

local function decode_acknowledgement_cursor(token, direction)
  if token == nil then return nil end
  if #token == 0 or #token > 8192 or #token % 2 ~= 0 or token:find("[^0-9a-f]") then
    invalid("cursor is malformed")
  end
  local decoded = token:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end)
  local ok, value = pcall(json.decode, decoded)
  if not ok or type(value) ~= "table" or value.v ~= 1 or value.d ~= direction
    or type(value.t) ~= "string" or type(value.u) ~= "string" then
    invalid("cursor is malformed or belongs to another sortDirection")
  end
  for key in pairs(value) do
    if key ~= "v" and key ~= "d" and key ~= "t" and key ~= "u" then invalid("cursor is malformed") end
  end
  local valid, collection = valid_record_uri(value.u)
  if not valid_cursor_timestamp(value.t) or not valid or collection ~= ACKNOWLEDGEMENT then
    invalid("cursor is malformed")
  end
  return value
end

local function acknowledgement_sort_expression()
  local created = "acknowledgement.record::jsonb->>'createdAt'"
  local pattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  local record_timestamp = "CASE WHEN jsonb_typeof(acknowledgement.record::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. pattern .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE NULL END"
  return "COALESCE(" .. record_timestamp .. ", acknowledgement.indexed_at::timestamptz, " ..
    "acknowledgement.created_at::timestamptz)"
end

local function acknowledgement_list_query(authors, subjects, limit, cursor, direction)
  local where, values = { "acknowledgement.collection = $1" }, { ACKNOWLEDGEMENT }
  if authors then
    if #authors == 0 then
      where[#where + 1] = "FALSE"
    else
      where[#where + 1] = "acknowledgement.did IN (" ..
        table.concat(bind_acknowledgement_values(values, authors), ", ") .. ")"
    end
  end
  if subjects then
    if #subjects == 0 then
      where[#where + 1] = "FALSE"
    else
      where[#where + 1] = "acknowledgement.record::jsonb->'subject'->>'uri' IN (" ..
        table.concat(bind_acknowledgement_values(values, subjects), ", ") .. ")"
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
    page_where[#page_where + 1] = "(sorted.sort_at, acknowledgement.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end
  page_values[#page_values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT acknowledgement.uri, acknowledgement.did, acknowledgement.cid, " ..
    "acknowledgement.indexed_at::text AS indexed_at, acknowledgement.record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS acknowledgement CROSS JOIN LATERAL (SELECT " ..
    acknowledgement_sort_expression() .. " AS sort_at) AS sorted WHERE " ..
    table.concat(page_where, " AND ") .. " " ..
    "ORDER BY sorted.sort_at " .. ordering .. ", acknowledgement.uri " .. ordering .. " LIMIT $" .. #page_values
  return acknowledgement_query(sql, page_values)
end

local function list_acknowledgements()
  keys_only(params, {
    authors = true,
    subjects = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  })
  local authors = acknowledgement_array("authors", "did")
  local subjects = acknowledgement_array("subjects", "at-uri")
  local direction = scalar(params, "sortDirection") or "desc"
  if direction ~= "asc" and direction ~= "desc" then invalid("sortDirection must be 'asc' or 'desc'") end
  local limit_value = scalar(params, "limit")
  if limit_value and not limit_value:match("^%d+$") then invalid("limit must be an integer from 1 through 100") end
  local limit = limit_value and tonumber(limit_value) or 25
  if not limit or limit % 1 ~= 0 or limit < 1 or limit > 100 then
    invalid("limit must be an integer from 1 through 100")
  end
  local cursor = decode_acknowledgement_cursor(scalar(params, "cursor"), direction)
  local rows = acknowledgement_list_query(authors, subjects, limit, cursor, direction)
  local acknowledgements = {}
  for index = 1, math.min(#rows, limit) do
    acknowledgements[#acknowledgements + 1] = acknowledgement_record_view(rows[index])
  end
  if #acknowledgements > 0 then hydrate_acknowledgement_authors(acknowledgements) end

  local response = { acknowledgements = toarray(acknowledgements) }
  if #rows > limit then
    local last = rows[limit]
    response.cursor = cursor_encode({
      v = 1,
      d = direction,
      t = last.sort_timestamp,
      u = last.uri,
    })
  end
  return response
end

function handle()
  return list_acknowledgements()
end
