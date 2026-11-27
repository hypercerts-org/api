local EVMLINK = "app.certified.link.evm"

local function evm_link_query(sql, values)
  if db.backend() ~= "postgres" then
    error("EvmLinkQueryFailed: EVM-link API requires PostgreSQL", 0)
  end
  local ok, rows = pcall(db.raw, sql, values)
  if not ok then error("EvmLinkQueryFailed: EVM-link listing failed", 0) end
  return rows
end

local function valid_evm_address(value)
  return #value == 42 and value:match("^0x%x+$") ~= nil
end

local function evm_link_filter_values(key, validate, description, normalize)
  local supplied = query_string_values(params, key)
  if not supplied then return nil end
  return unique_query_values(supplied, function(item, index)
    if not validate(item) then
      invalid(key .. "[" .. index .. "] must be " .. description)
    end
    return normalize and normalize(item) or item
  end)
end

local function add_filter(where, values, expression, items)
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
  where[#where + 1] = expression .. " IN (" .. table.concat(placeholders, ",") .. ")"
end

local function list_evm_links(actors, addresses, limit, cursor, direction)
  local where, values = { "link.collection = $1" }, { EVMLINK }
  add_filter(where, values, "link.did", actors)
  add_filter(where, values, "lower(link.record::jsonb->>'address')", addresses)

  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, link.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT link.uri, link.did, link.cid, link.indexed_at::text AS indexed_at, " ..
    "link.record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', " ..
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS link CROSS JOIN LATERAL (SELECT " .. created_at_sort("link") .. " AS sort_at) sorted WHERE " ..
    table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", link.uri " .. ordering .. " LIMIT $" .. #values
  local rows = evm_link_query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local views, actors_to_hydrate = {}, {}
  for _, row in ipairs(rows) do
    local view = record_view(row)
    view.actor = { did = view.did }
    views[#views + 1] = view
    actors_to_hydrate[#actors_to_hydrate + 1] = view.actor
  end
  hydrate_actor_views(actors_to_hydrate, evm_link_query)
  normalize_evm_actor_indexed_at(actors_to_hydrate)

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end

function handle()
  keys_only(params, {
    actors = true,
    addresses = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  })
  local actors = evm_link_filter_values("actors", valid_did, "valid DIDs")
  local addresses = evm_link_filter_values("addresses", valid_evm_address, "a 0x-prefixed 40-digit hexadecimal EVM address", string.lower)
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, valid_evm_link_uri)
  local views, next_cursor = list_evm_links(actors, addresses, limit, cursor, direction)
  local response = { evmLinks = toarray(views) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
