local FEATURE_VIEW_TYPE = "org.hypercerts.entity.defs#featureView"

local function feature_array(params, key, validate, description, max_bytes)
  local value = params[key]
  if value == nil then return nil end
  local values = {}
  if type(value) == "string" then
    values[1] = value
  elseif type(value) == "table" then
    local count = 0
    for index in pairs(value) do
      if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
        invalid(key .. " must use repeated string query parameters")
      end
      count = count + 1
    end
    if count ~= #value then invalid(key .. " must use repeated string query parameters") end
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
    if max_bytes and #item > max_bytes then
      invalid(key .. " entries must be at most " .. max_bytes .. " UTF-8 bytes")
    end
    if validate and not validate(item) then invalid("each " .. key .. " value must be " .. description) end
    if not seen[item] then
      seen[item] = true
      unique[#unique + 1] = item
    end
  end
  return unique
end

local function feature_add_in(where, values, column, binds)
  if values == nil then return end
  if #values == 0 then
    where[#where + 1] = "FALSE"
    return
  end
  local placeholders = {}
  for _, value in ipairs(values) do
    binds[#binds + 1] = value
    placeholders[#placeholders + 1] = "$" .. #binds
  end
  where[#where + 1] = column .. " IN (" .. table.concat(placeholders, ", ") .. ")"
end

local function feature_add_types(where, values, binds)
  if values == nil then return end
  if #values == 0 then
    where[#where + 1] = "FALSE"
    return
  end
  local placeholders = {}
  for _, value in ipairs(values) do
    binds[#binds + 1] = value
    placeholders[#placeholders + 1] = "$" .. #binds
  end
  where[#where + 1] = "(jsonb_typeof(feature.record::jsonb -> 'type') = 'string' AND " ..
    "feature.record::jsonb ->> 'type' IN (" .. table.concat(placeholders, ", ") .. "))"
end

local function feature_parse_organization_filter(params)
  local value = params.hasOrganizationRecord
  if value == nil then return nil end
  if type(value) == "boolean" then return value end
  value = scalar(params, "hasOrganizationRecord")
  if value == "true" then return true end
  if value == "false" then return false end
  invalid("hasOrganizationRecord must be true or false")
end

local function feature_cursor_decode(token, direction)
  if token == nil then return nil end
  if type(token) ~= "string" or #token > 32768 or #token % 2 ~= 0 or token:find("[^0-9a-f]") then
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
  if not feature_valid_uri(value.u) or value.t:sub(1, 4) == "0000" or not valid_datetime(value.t) then
    invalid("cursor is malformed")
  end
  return value
end

local function feature_query_rows(sql, binds)
  if db.backend() ~= "postgres" then error("FeatureQueryFailed: feature API requires PostgreSQL", 0) end
  local ok, rows = pcall(db.raw, sql, binds)
  if not ok or type(rows) ~= "table" then error("FeatureQueryFailed: feature lookup failed", 0) end
  return rows
end

local function feature_make_view(row)
  local view = feature_projection_view(row)
  view["$type"] = FEATURE_VIEW_TYPE
  return view
end

local function feature_hydrate(views)
  local ok = pcall(feature_projection_hydrate, views)
  if not ok then error("FeatureQueryFailed: author hydration failed", 0) end
end

local function feature_list_rows(filters, limit, cursor, direction)
  local where, binds = { "feature.collection = $1" }, { FEATURE_COLLECTION }
  feature_add_in(where, filters.authors, "feature.did", binds)
  feature_add_types(where, filters.types, binds)
  if filters.hasOrganizationRecord ~= nil then
    local predicate = filters.hasOrganizationRecord and "EXISTS" or "NOT EXISTS"
    where[#where + 1] = predicate .. " (SELECT 1 FROM happyview_records AS organization " ..
      "WHERE organization.collection = 'app.certified.actor.organization' " ..
      "AND organization.rkey = 'self' AND organization.did = feature.did)"
  end
  if cursor then
    binds[#binds + 1] = cursor.t
    local time = "$" .. #binds
    binds[#binds + 1] = cursor.u
    local uri = "$" .. #binds
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, feature.uri) " .. operator .. " ((" .. time .. ")::timestamptz, " .. uri .. ")"
  end

  binds[#binds + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local created_at = "feature.record::jsonb ->> 'createdAt'"
  local zoned_datetime = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  local sort_key = "CASE WHEN jsonb_typeof(feature.record::jsonb -> 'createdAt') = 'string' AND " ..
    created_at .. " ~ '" .. zoned_datetime .. "' AND " .. created_at .. " !~ '-00:00$' AND " ..
    "pg_input_is_valid(" .. created_at .. ", 'timestamptz') THEN (" .. created_at .. ")::timestamptz " ..
    "ELSE COALESCE(feature.indexed_at::timestamptz, feature.created_at::timestamptz) END"
  local sql = "SELECT feature.uri, feature.did, feature.cid, feature.indexed_at::text AS indexed_at, " ..
    "feature.record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', " ..
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS feature CROSS JOIN LATERAL (SELECT " .. sort_key .. " AS sort_at) AS sorted " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", feature.uri " .. ordering .. " LIMIT $" .. #binds
  return feature_query_rows(sql, binds)
end

local function list_features()
  keys_only(params, {
    authors = true,
    hasOrganizationRecord = true,
    types = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  })
  local authors = feature_array(params, "authors", valid_did, "valid DIDs")
  local types = feature_array(params, "types", nil, nil, 64)
  local has_organization_record = feature_parse_organization_filter(params)
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor_value = params.cursor
  if cursor_value ~= nil and type(cursor_value) ~= "string" then invalid("cursor must occur once as a string") end
  local cursor = feature_cursor_decode(cursor_value, direction)
  local rows = feature_list_rows({
    authors = authors,
    hasOrganizationRecord = has_organization_record,
    types = types,
  }, limit, cursor, direction)

  local more = #rows > limit
  if more then rows[#rows] = nil end
  local views = {}
  for _, row in ipairs(rows) do views[#views + 1] = feature_make_view(row) end
  feature_hydrate(views)

  local response = { features = toarray(views) }
  if more then
    local last = rows[#rows]
    response.cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return response
end

function handle()
  return list_features()
end
