local function contributor_information_datetime(value)
  return valid_datetime(value) and tonumber(value:sub(1, 4)) > 0
end

local function contributor_information_query(sql, values)
  local backend_ok, backend = pcall(db.backend)
  if not backend_ok or backend ~= "postgres" then
    error("ContributorInformationQueryFailed: contributor-information queries require PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ContributorInformationQueryFailed: contributor-information query failed", 0)
  end
  return result
end

local function contributor_information_array(params, key, validate, description)
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
    if validate and not validate(item) then
      invalid("each " .. key .. " value must be " .. description .. "; resolve handles to DIDs first")
    end
    if not seen[item] then
      seen[item] = true
      unique[#unique + 1] = item
    end
  end
  return unique
end

local function contributor_information_bind_in(where, values, expression, items)
  if not items then return end
  if #items == 0 then
    where[#where + 1] = "FALSE"
    return
  end
  local placeholders = {}
  for _, item in ipairs(items) do
    values[#values + 1] = item
    placeholders[#placeholders + 1] = "$" .. #values
  end
  where[#where + 1] = expression .. " IN (" .. table.concat(placeholders, ", ") .. ")"
end

local function contributor_information_cursor_decode(token, direction)
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
  if not contributor_information_uri(value.u) or not contributor_information_datetime(value.t) then
    invalid("cursor is malformed")
  end
  return value
end

local function preserve_contributor_author_timestamps(author)
  local null = json.decode("null")
  for _, field in ipairs({ "profile", "organization" }) do
    local sidecar = author[field]
    if sidecar ~= null and type(sidecar) == "table" and sidecar.indexedAt == nil then
      sidecar.indexedAt = null
    end
  end
end

local function contributor_information_sort_expression()
  local created = "contributor.record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(contributor.record::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. zoned .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE " ..
    "COALESCE(contributor.indexed_at::timestamptz, contributor.created_at::timestamptz) END"
end

local function query_contributor_information(authors, limit, cursor, direction)
  local where, values = { "contributor.collection = $1" }, { CONTRIBUTOR_INFORMATION_COLLECTION }
  contributor_information_bind_in(where, values, "contributor.did", authors)

  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, contributor.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sort_key = contributor_information_sort_expression()
  local sql = "SELECT contributor.uri, contributor.did, contributor.cid, " ..
    "contributor.indexed_at::text AS indexed_at, contributor.record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS contributor CROSS JOIN LATERAL (SELECT " .. sort_key .. " AS sort_at) AS sorted " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", contributor.uri " .. ordering .. " LIMIT $" .. #values
  local rows = contributor_information_query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local views, authors_to_hydrate = {}, {}
  for _, row in ipairs(rows) do
    local view = record_view(row)
    if row.indexed_at == nil then view.indexedAt = json.decode("null") end
    view.author = { did = row.did }
    views[#views + 1] = view
    authors_to_hydrate[#authors_to_hydrate + 1] = view.author
  end
  hydrate_actor_views(authors_to_hydrate, contributor_information_query)
  for _, author in ipairs(authors_to_hydrate) do preserve_contributor_author_timestamps(author) end

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end

function handle()
  keys_only(params, {
    authors = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  })
  local authors = contributor_information_array(params, "authors", contributor_information_did, "valid DIDs")
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = contributor_information_cursor_decode(scalar(params, "cursor"), direction)
  local views, next_cursor = query_contributor_information(authors, limit, cursor, direction)
  local response = { contributorInformation = toarray(views) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
