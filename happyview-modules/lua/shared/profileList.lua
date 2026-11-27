local function valid_profile_uri(value)
  local valid, collection = valid_record_uri(value)
  -- The record key is the last path segment, so this suffix means rkey == "self".
  return valid and collection == PROFILE and value:sub(-5) == "/self"
end

local function profile_filter_values(params, key)
  local supplied = query_string_values(params, key)
  if not supplied then return nil end
  return unique_query_values(supplied, function(item)
    if not valid_did(item) then invalid("each " .. key .. " value must be a valid DID") end
  end)
end

local function query_profiles(actors, search, limit, cursor, direction)
  local where, values = { "collection = $1", "rkey = 'self'" }, { PROFILE }
  if actors then add_in(where, values, "did", actors) end
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
  local sort_key = created_at_sort()
  local sql = "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record, "
    .. "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp "
    .. "FROM happyview_records CROSS JOIN LATERAL (SELECT " .. sort_key .. " AS sort_at) sorted WHERE "
    .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering .. ", uri " .. ordering .. " LIMIT $" .. #values
  local rows = query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local profiles = {}
  for _, row in ipairs(rows) do profiles[#profiles + 1] = record_view(row) end
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
  if search_enabled then actors = profile_filter_values(params, "actors") end
  local search
  if search_enabled then
    search = scalar(params, "search")
    if search == nil then invalid("search is required") end
    search = search:match("^%s*(.-)%s*$")
    if search == "" then search = nil else search = search:lower() end
  end

  local limit = parse_list_limit(params)

  local direction = parse_sort_direction(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, valid_profile_uri)
  local profiles, next_cursor = query_profiles(actors, search, limit, cursor, direction)
  local response = { profiles = toarray(profiles) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
