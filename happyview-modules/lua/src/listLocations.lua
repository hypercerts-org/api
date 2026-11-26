local function location_filter_values(params, key, validate, description, max_bytes)
  local supplied = query_string_values(params, key)
  if not supplied then return nil end
  return unique_query_values(supplied, function(item)
    if max_bytes and #item > max_bytes then invalid(key .. " entries must be at most " .. max_bytes .. " UTF-8 bytes") end
    if validate and not validate(item) then invalid("each " .. key .. " value must be " .. description) end
  end)
end

local function add_optional_in(where, params, column, values)
  if not values then return end
  if #values == 0 then where[#where + 1] = "FALSE"; return end
  local placeholders = {}
  for _, value in ipairs(values) do
    params[#params + 1] = value
    placeholders[#placeholders + 1] = "$" .. #params
  end
  where[#where + 1] = column .. " IN (" .. table.concat(placeholders, ",") .. ")"
end

local function query_locations(filters, limit, cursor, direction)
  if db.backend() ~= "postgres" then error("LocationQueryFailed: location API requires PostgreSQL", 0) end
  local where, binds = { "collection = $1" }, { COLLECTION }
  add_optional_in(where, binds, "did", filters.authors)
  add_optional_in(where, binds, "uri", filters.uris)
  add_optional_in(where, binds, "(record::jsonb)->>'locationType'", filters.locationTypes)
  if cursor then
    binds[#binds + 1] = cursor.t
    local time = "$" .. #binds
    binds[#binds + 1] = cursor.u
    local uri = "$" .. #binds
    local op = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, uri) " .. op .. " ((" .. time .. ")::timestamptz, " .. uri .. ")"
  end
  binds[#binds + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp FROM happyview_records CROSS JOIN LATERAL (SELECT " .. created_at_sort() .. " AS sort_at) sorted WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering .. ", uri " .. ordering .. " LIMIT $" .. #binds
  local rows = query(sql, binds)
  local more = #rows > limit
  if more then rows[#rows] = nil end
  local views = {}
  for _, row in ipairs(rows) do views[#views + 1] = record_view(row) end
  hydrate(views)
  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end

local function list_locations()
  keys_only(params, { authors = true, uris = true, locationTypes = true, limit = true, cursor = true, sortDirection = true })
  local authors = location_filter_values(params, "authors", valid_did, "valid DIDs")
  local uris = location_filter_values(params, "uris", valid_location_uri, "full app.certified.location AT-URIs with DID authorities")
  local types = location_filter_values(params, "locationTypes", nil, nil, 20)
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, valid_location_uri)
  local views, next_cursor = query_locations({ authors = authors, uris = uris, locationTypes = types }, limit, cursor, direction)
  local response = { locations = toarray(views) }
  if next_cursor then response.cursor = next_cursor end
  return response
end

function handle()
  return list_locations()
end
