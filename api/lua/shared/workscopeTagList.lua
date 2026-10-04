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

local function workscope_tag_decode_cursor(token, direction)
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
  if not valid_datetime(value.t) or not valid or collection ~= WORKSCOPE_TAG then
    invalid("cursor is malformed")
  end
  return value
end

local function workscope_tag_list()
  keys_only(params, { authors = true, sortDirection = true, limit = true, cursor = true })
  local authors = workscope_tag_array("authors")
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = workscope_tag_decode_cursor(scalar(params, "cursor"), direction)

  local where, values = { "workscope_tag.collection = $1" }, { WORKSCOPE_TAG }
  if authors then
    if #authors == 0 then
      where[#where + 1] = "FALSE"
    else
      local placeholders = {}
      for _, did in ipairs(authors) do
        values[#values + 1] = did
        placeholders[#placeholders + 1] = "$" .. #values
      end
      where[#where + 1] = "workscope_tag.did IN (" .. table.concat(placeholders, ", ") .. ")"
    end
  end
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
  local sql = "SELECT workscope_tag.uri, workscope_tag.did, workscope_tag.cid, " ..
    "workscope_tag.indexed_at::text AS indexed_at, workscope_tag.record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS workscope_tag CROSS JOIN LATERAL (SELECT (" .. created_at ..
    ")::timestamptz AS sort_at) AS sorted WHERE " .. table.concat(where, " AND ") ..
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
  hydrate_actor_views(authors_to_hydrate, workscope_tag_query)

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end
