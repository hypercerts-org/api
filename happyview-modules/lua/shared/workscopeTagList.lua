local function workscope_tag_filter_values(key)
  local supplied = query_string_values(params, key)
  if not supplied then return nil end
  return unique_query_values(supplied, function(did)
    if not valid_did(did) then
      invalid("each " .. key .. " value must be a valid DID; resolve handles to DIDs first")
    end
  end)
end

local function workscope_tag_list()
  keys_only(params, { authors = true, sortDirection = true, limit = true, cursor = true })
  local authors = workscope_tag_filter_values("authors")
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, WORKSCOPE_TAG)

  local where, values = { "workscope_tag.collection = $1" }, { WORKSCOPE_TAG }
  if authors then add_in(where, values, "workscope_tag.did", authors) end
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
  local valid_zoned_created_at = created_at .. " ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$' AND " ..
    created_at .. " !~ '-00:00$' AND pg_input_is_valid(" .. created_at .. ", 'timestamp with time zone')"
  local indexed_at = "workscope_tag.indexed_at"
  local row_created_at = "workscope_tag.created_at"
  local function timestamp_fallback(column)
    return "CASE WHEN pg_input_is_valid(" .. column .. ", 'timestamp with time zone') THEN " .. column .. "::timestamptz END"
  end
  local sort_at = "COALESCE(CASE WHEN " .. valid_zoned_created_at .. " THEN (" .. created_at ..
    ")::timestamptz END, " .. timestamp_fallback(indexed_at) .. ", " .. timestamp_fallback(row_created_at) .. ")"
  local sql = "SELECT workscope_tag.uri, workscope_tag.did, workscope_tag.cid, " ..
    "workscope_tag.indexed_at::text AS indexed_at, workscope_tag.record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS workscope_tag CROSS JOIN LATERAL (SELECT " .. sort_at ..
    " AS sort_at) AS sorted WHERE " .. table.concat(where, " AND ") ..
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
  hydrate_actor_views(authors_to_hydrate, workscope_tag_query, record_view_omitting_indexed_at)

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end
