local COLLECTION = BADGE_DEFINITION_COLLECTION

local function query(sql, values)
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("BadgeDefinitionQueryFailed: badge definition query failed", 0) end
  return result
end

local function badge_definition_filter_values(params, key, validate, description, max_bytes)
  local supplied = query_string_values(params, key)
  if not supplied then return nil end
  return unique_query_values(supplied, function(item)
    if max_bytes and #item > max_bytes then
      invalid(key .. " entries must be at most " .. max_bytes .. " UTF-8 bytes")
    end
    if validate and not validate(item) then invalid("each " .. key .. " value must be " .. description) end
  end)
end

local function add_badge_definition_filter(where, values, column, items)
  if not items then return end
  if #items == 0 then where[#where + 1] = "FALSE"; return end
  local placeholders = {}
  for _, item in ipairs(items) do
    values[#values + 1] = item
    placeholders[#placeholders + 1] = "$" .. #values
  end
  where[#where + 1] = column .. " IN (" .. table.concat(placeholders, ",") .. ")"
end

local function list_badge_definitions(authors, badge_types, limit, cursor, direction)
  if db.backend() ~= "postgres" then
    error("BadgeDefinitionQueryFailed: badge definition API requires PostgreSQL", 0)
  end
  local where, values = { "collection = $1" }, { COLLECTION }
  add_badge_definition_filter(where, values, "did", authors)
  add_badge_definition_filter(where, values, "record::jsonb->>'badgeType'", badge_types)
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
  local sort_expression = created_at_sort()
  local sql = "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records CROSS JOIN LATERAL (SELECT " .. sort_expression .. " AS sort_at) sorted WHERE " ..
    table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering .. ", uri " .. ordering ..
    " LIMIT $" .. #values
  local rows = query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end
  local views, authors_to_hydrate = {}, {}
  for _, row in ipairs(rows) do
    local view = record_view(row)
    view.author = { did = view.did }
    views[#views + 1] = view
    authors_to_hydrate[#authors_to_hydrate + 1] = view.author
  end
  hydrate_actor_views(authors_to_hydrate, query)
  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end

local function handle_list_badge_definitions()
  keys_only(params, { authors = true, badgeTypes = true, limit = true, cursor = true, sortDirection = true })
  local authors = badge_definition_filter_values(params, "authors", valid_did, "valid DIDs")
  local badge_types = badge_definition_filter_values(params, "badgeTypes", nil, nil, 100)
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, valid_badge_definition_uri)
  local views, next_cursor = list_badge_definitions(authors, badge_types, limit, cursor, direction)
  local response = { badgeDefinitions = toarray(views) }
  if next_cursor then response.cursor = next_cursor end
  return response
end

function handle()
  return handle_list_badge_definitions()
end
