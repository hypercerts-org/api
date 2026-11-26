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

local function contributor_information_filter_values(params, key, validate, description)
  local supplied = query_string_values(params, key)
  if not supplied then return nil end
  return unique_query_values(supplied, function(item)
    if validate and not validate(item) then
      invalid("each " .. key .. " value must be " .. description .. "; resolve handles to DIDs first")
    end
  end)
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

local function query_contributor_information(authors, limit, cursor, direction)
  local where, values = { "contributor.collection = $1" }, { CONTRIBUTOR_INFORMATION_COLLECTION }
  if authors then add_in(where, values, "contributor.did", authors) end

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
  local sort_key = created_at_sort("contributor")
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
  local authors = contributor_information_filter_values(params, "authors", valid_did, "valid DIDs")
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, contributor_information_uri)
  local views, next_cursor = query_contributor_information(authors, limit, cursor, direction)
  local response = { contributorInformation = toarray(views) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
