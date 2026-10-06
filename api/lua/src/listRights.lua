local RIGHTS = "org.hypercerts.claim.rights"

local function rights_list_run_query(sql, values)
  if db.backend() ~= "postgres" then error("RightsQueryFailed: rights API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then error("RightsQueryFailed: rights lookup failed", 0) end
  return result
end

local function rights_list_array(value)
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

  local unique, seen = {}, {}
  for _, did in ipairs(supplied) do
    if not rights_valid_did(did) then invalid("each authors value must be a valid DID") end
    if not seen[did] then
      seen[did] = true
      unique[#unique + 1] = did
    end
  end
  return unique
end

local function rights_list_cursor_decode(token, direction)
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
  local valid, collection = rights_valid_record_uri(value.u)
  local year = tonumber(value.t:sub(1, 4))
  if not valid_datetime(value.t) or not year or year < 1 or not valid or collection ~= RIGHTS then
    invalid("cursor is malformed")
  end
  return value
end

local function rights_sort_expression()
  local created = "rights.record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(rights.record::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. zoned .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE " ..
    "COALESCE(rights.indexed_at::timestamptz, rights.created_at::timestamptz) END"
end

local function rights_list_query(authors, limit, cursor, direction)
  local where, values = { "rights.collection = $1" }, { RIGHTS }

  if authors then
    if #authors == 0 then
      where[#where + 1] = "FALSE"
    else
      local marks = {}
      for _, did in ipairs(authors) do
        values[#values + 1] = did
        marks[#marks + 1] = "$" .. #values
      end
      where[#where + 1] = "rights.did IN (" .. table.concat(marks, ", ") .. ")"
    end
  end

  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, rights.uri) " .. operator .. " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT rights.uri, rights.did, rights.cid, rights.indexed_at::text AS indexed_at, " ..
    "rights.record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', " ..
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS rights CROSS JOIN LATERAL (SELECT " .. rights_sort_expression() .. " AS sort_at) AS sorted " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", rights.uri " .. ordering .. " LIMIT $" .. #values
  local rows = rights_list_run_query(sql, values)

  local more = #rows > limit
  if more then rows[#rows] = nil end

  local views, authors_to_hydrate = {}, {}
  for _, row in ipairs(rows) do
    local view = rights_record_view(row)
    view.author = { did = view.did }
    views[#views + 1] = view
    authors_to_hydrate[#authors_to_hydrate + 1] = view.author
  end
  rights_hydrate_actor_views(authors_to_hydrate, rights_list_run_query)

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end

local function rights_list_response()
  keys_only(params, { authors = true, sortDirection = true, limit = true, cursor = true })
  local authors = rights_list_array(params.authors)
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = rights_list_cursor_decode(scalar(params, "cursor"), direction)
  local rights, next_cursor = rights_list_query(authors, limit, cursor, direction)
  local response = { rights = toarray(rights) }
  if next_cursor then response.cursor = next_cursor end
  return response
end

function handle()
  return rights_list_response()
end
