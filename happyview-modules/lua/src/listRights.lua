local RIGHTS = "org.hypercerts.claim.rights"

local function rights_list_run_query(sql, values)
  if db.backend() ~= "postgres" then error("RightsQueryFailed: rights API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then error("RightsQueryFailed: rights lookup failed", 0) end
  return result
end

local function rights_list_query(authors, limit, cursor, direction)
  local where, values = { "rights.collection = $1" }, { RIGHTS }

  if authors then add_in(where, values, "rights.did", authors) end

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
    "FROM happyview_records AS rights CROSS JOIN LATERAL (SELECT " .. created_at_sort("rights") .. " AS sort_at) AS sorted " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", rights.uri " .. ordering .. " LIMIT $" .. #values
  local rows = rights_list_run_query(sql, values)

  local more = #rows > limit
  if more then rows[#rows] = nil end

  local views, authors_to_hydrate = {}, {}
  for _, row in ipairs(rows) do
    local view = record_view(row)
    view.author = { did = view.did }
    views[#views + 1] = view
    authors_to_hydrate[#authors_to_hydrate + 1] = view.author
  end
  hydrate_actor_views(authors_to_hydrate, rights_list_run_query)

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end

local function rights_list_response()
  keys_only(params, { authors = true, sortDirection = true, limit = true, cursor = true })
  local authors = query_string_values(params, "authors")
  authors = authors and unique_query_values(authors, function(did)
    if not valid_did(did) then invalid("each authors value must be a valid DID") end
  end)
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, RIGHTS)
  local rights, next_cursor = rights_list_query(authors, limit, cursor, direction)
  local response = { rights = toarray(rights) }
  if next_cursor then response.cursor = next_cursor end
  return response
end

function handle()
  return rights_list_response()
end
