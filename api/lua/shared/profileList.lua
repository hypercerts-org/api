local function valid_profile_uri(value)
  if type(value) ~= "string" or value:find("[?#]") then return false end
  local authority, collection, rkey = value:match("^at://([^/]+)/([^/]+)/([^/]+)$")
  return authority ~= nil and valid_did(authority) and collection == PROFILE and rkey == "self"
end

local function array(params, key)
  local value = params[key]
  if value == nil then return nil end
  local values = {}
  if type(value) == "string" then values[1] = value
  elseif type(value) == "table" then
    for index = 1, #value do
      if type(value[index]) ~= "string" then invalid(key .. " entries must be strings") end
      values[#values + 1] = value[index]
    end
  else
    invalid(key .. " must be a string or repeated string parameter")
  end
  if #values > 100 then invalid(key .. " accepts at most 100 values") end
  local unique, seen = {}, {}
  for _, item in ipairs(values) do
    if not valid_did(item) then invalid("each " .. key .. " value must be a valid DID") end
    if not seen[item] then seen[item] = true; unique[#unique + 1] = item end
  end
  return unique
end

local function add_actors(where, values, actors)
  if not actors then return end
  if #actors == 0 then where[#where + 1] = "FALSE"; return end
  local placeholders = {}
  for _, did in ipairs(actors) do
    values[#values + 1] = did
    placeholders[#placeholders + 1] = "$" .. #values
  end
  where[#where + 1] = "did IN (" .. table.concat(placeholders, ", ") .. ")"
end

local function cursor_encode(value)
  local encoded = json.encode(value)
  return (encoded:gsub(".", function(char) return string.format("%02x", string.byte(char)) end))
end

local function cursor_decode(token, direction)
  if not token then return nil end
  if #token % 2 ~= 0 or token:find("[^0-9a-f]") then invalid("cursor is malformed") end
  local decoded = token:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end)
  local ok, value = pcall(json.decode, decoded)
  if not ok or type(value) ~= "table" or value.v ~= 1 or value.d ~= direction
    or type(value.t) ~= "string" or type(value.u) ~= "string" then
    invalid("cursor is malformed or belongs to another sortDirection")
  end
  for key in pairs(value) do
    if key ~= "v" and key ~= "d" and key ~= "t" and key ~= "u" then invalid("cursor is malformed") end
  end
  if not valid_profile_uri(value.u) or not valid_datetime(value.t) then invalid("cursor is malformed") end
  return value
end

local function query_profiles(actors, search, limit, cursor, direction)
  local where, values = { "collection = $1", "rkey = 'self'" }, { PROFILE }
  add_actors(where, values, actors)
  if search then
    values[#values + 1] = search
    local term = "$" .. #values
    where[#where + 1] = "(strpos(lower(COALESCE(record::jsonb->>'displayName', '')), lower(" .. term
      .. ")) > 0 OR strpos(lower(COALESCE(record::jsonb->>'description', '')), lower(" .. term .. ")) > 0)"
  end
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, uri) " .. operator .. " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local created = "record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  local sort_key = "CASE WHEN jsonb_typeof(record::jsonb->'createdAt') = 'string' AND " .. created .. " ~ '" .. zoned
    .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created .. ", 'timestamptz') THEN (" .. created
    .. ")::timestamptz ELSE COALESCE(indexed_at::timestamptz, created_at::timestamptz) END"
  local sql = "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record, "
    .. "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp "
    .. "FROM happyview_records CROSS JOIN LATERAL (SELECT " .. sort_key .. " AS sort_at) sorted WHERE "
    .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering .. ", uri " .. ordering .. " LIMIT $" .. #values
  local rows = query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local profiles = {}
  for _, row in ipairs(rows) do profiles[#profiles + 1] = row_view(row) end
  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return profiles, next_cursor
end

local function profiles_response(search_enabled)
  local allowed = { limit = true, cursor = true, sortDirection = true }
  if search_enabled then
    allowed.actors = true
    allowed.search = true
  end
  keys_only(params, allowed)
  local actors
  if search_enabled then actors = array(params, "actors") end
  local search
  if search_enabled then
    search = scalar(params, "search")
    if search == nil then invalid("search is required") end
    search = search:match("^%s*(.-)%s*$")
    if search == "" then search = nil else search = search:lower() end
  end

  local limit = parse_list_limit(params)

  local direction = scalar(params, "sortDirection") or "desc"
  if direction ~= "asc" and direction ~= "desc" then invalid("sortDirection must be 'asc' or 'desc'") end
  local cursor = cursor_decode(scalar(params, "cursor"), direction)
  local profiles, next_cursor = query_profiles(actors, search, limit, cursor, direction)
  local response = { profiles = toarray(profiles) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
