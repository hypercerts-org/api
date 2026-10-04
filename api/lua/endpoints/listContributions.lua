local function invalid(message)
  error("InvalidRequest: " .. message, 0)
end

local function keys_only(values, allowed)
  for key in pairs(values) do
    if not allowed[key] then invalid("unknown query parameter") end
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

local function valid_did(value)
  if #value > 2048 then return false end
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
  return true, collection
end

local function valid_datetime(value)
  local year, month, day, hour, minute, second, suffix = value:match(
    "^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)(.*)$")
  if not year then return false end
  year, month, day = tonumber(year), tonumber(month), tonumber(day)
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

local function parse_sort_direction(params)
  local direction = scalar(params, "sortDirection") or "desc"
  if direction ~= "asc" and direction ~= "desc" then invalid("sortDirection must be 'asc' or 'desc'") end
  return direction
end

local function cursor_encode(value)
  local encoded = json.encode(value)
  return (encoded:gsub(".", function(char) return string.format("%02x", string.byte(char)) end))
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

local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"

local function hydrate_actor_views(actors, run_query)
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
    actor.profile = profiles[actor.did] and record_view(profiles[actor.did]) or NULL
    actor.organization = organizations[actor.did] and record_view(organizations[actor.did]) or NULL
  end
end

local CONTRIBUTION = "org.hypercerts.claim.contribution"

local function valid_contribution_did(value)
  if type(value) ~= "string" or not valid_did(value) then return false end
  local index = 1
  while index <= #value do
    if value:sub(index, index) == "%" then
      local escape = value:sub(index + 1, index + 2)
      if #escape ~= 2 or escape:find("[^0-9A-Fa-f]") then return false end
      index = index + 3
    else
      index = index + 1
    end
  end
  return true
end

local function valid_contribution_uri(value)
  local valid, collection = valid_record_uri(value)
  if not valid or collection ~= CONTRIBUTION then return false end
  local authority = value:match("^at://([^/]+)/")
  return valid_contribution_did(authority)
end

local function contribution_query(sql, values)
  if db.backend() ~= "postgres" then
    error("ContributionQueryFailed: contribution API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ContributionQueryFailed: indexed contribution lookup failed", 0)
  end
  return result
end

local function contribution_view(row)
  local view = record_view(row)
  local author = { did = view.did }
  hydrate_actor_views({ author }, contribution_query)
  view.author = author
  return view
end

local function contribution_authors()
  local value = params.authors
  if value == nil then return nil end

  local supplied = {}
  if type(value) == "string" then
    supplied[1] = value
  elseif type(value) == "table" then
    local count = 0
    for index in pairs(value) do
      if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
        invalid("authors must use repeated query values")
      end
      count = count + 1
    end
    if count ~= #value then invalid("authors must use repeated query values") end
    for index = 1, count do
      if type(value[index]) ~= "string" then invalid("authors entries must be strings") end
      supplied[#supplied + 1] = value[index]
    end
  else
    invalid("authors must be a string or repeated string parameter")
  end
  if #supplied > 100 then invalid("authors accepts at most 100 values") end

  local authors, seen = {}, {}
  for _, did in ipairs(supplied) do
    if not valid_contribution_did(did) then invalid("each authors value must be a valid DID; resolve handles to DIDs first") end
    if not seen[did] then
      seen[did] = true
      authors[#authors + 1] = did
    end
  end
  return authors
end

local function valid_contribution_cursor_datetime(value)
  if type(value) ~= "string" or not valid_datetime(value) then return false end
  return value:sub(1, 4) ~= "0000"
end

local function decode_contribution_cursor(token, direction)
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
  local valid = valid_contribution_uri(value.u)
  if not valid or not valid_contribution_cursor_datetime(value.t) then
    invalid("cursor is malformed")
  end
  return value
end

local function add_contribution_authors(where, values, authors)
  if authors == nil then return end
  if #authors == 0 then
    where[#where + 1] = "FALSE"
    return
  end
  local placeholders = {}
  for _, did in ipairs(authors) do
    values[#values + 1] = did
    placeholders[#placeholders + 1] = "$" .. #values
  end
  where[#where + 1] = "contribution.did IN (" .. table.concat(placeholders, ", ") .. ")"
end

local function contribution_sort_key()
  local created = "contribution.record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(contribution.record::jsonb->'createdAt') = 'string' AND " .. created .. " ~ '" .. zoned
    .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created .. ", 'timestamptz') THEN (" .. created
    .. ")::timestamptz ELSE COALESCE(contribution.indexed_at::timestamptz, contribution.created_at::timestamptz, 'epoch'::timestamptz) END"
end

local function query_contributions(authors, limit, cursor, direction)
  local where, values = { "contribution.collection = $1" }, { CONTRIBUTION }
  add_contribution_authors(where, values, authors)
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, contribution.uri) " .. operator .. " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT contribution.uri, contribution.did, contribution.cid, " ..
    "contribution.indexed_at::text AS indexed_at, contribution.record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS contribution CROSS JOIN LATERAL (SELECT " .. contribution_sort_key() .. " AS sort_at) AS sorted " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", contribution.uri " .. ordering .. " LIMIT $" .. #values
  local rows = contribution_query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local contributions = {}
  for _, row in ipairs(rows) do contributions[#contributions + 1] = contribution_view(row) end
  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return contributions, next_cursor
end

function handle()
  keys_only(params, { authors = true, sortDirection = true, limit = true, cursor = true })
  local authors = contribution_authors()
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = decode_contribution_cursor(scalar(params, "cursor"), direction)
  local contributions, next_cursor = query_contributions(authors, limit, cursor, direction)
  local response = { contributions = toarray(contributions) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
