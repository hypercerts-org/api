local function contribution_authors()
  local supplied = query_string_values(params, "authors")
  if not supplied then return nil end
  return unique_query_values(supplied, function(did)
    if not valid_did(did) then invalid("each authors value must be a valid DID; resolve handles to DIDs first") end
  end)
end

local function contribution_sort_key()
  local created = "contribution.record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(contribution.record::jsonb->'createdAt') = 'string' AND " .. created .. " ~ '" .. zoned
    .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created .. ", 'timestamptz') THEN (" .. created
    .. ")::timestamptz ELSE COALESCE(contribution.indexed_at::timestamptz, contribution.created_at::timestamptz, 'epoch'::timestamptz) END"
end

local function query_contributions(authors, limit, cursor, direction)
  local where, values = { "contribution.collection = $1" }, { CONTRIBUTION }
  if authors then add_in(where, values, "contribution.did", authors) end
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, contribution.uri) " .. operator .. " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT contribution.uri, contribution.did, contribution.cid, " ..
    "contribution.indexed_at::text AS indexed_at, contribution.record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS contribution CROSS JOIN LATERAL (SELECT " .. contribution_sort_key() .. " AS sort_at) AS sorted " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", contribution.uri " .. ordering .. " LIMIT $" .. #values
  local rows = contribution_query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local contributions = {}
  for _, row in ipairs(rows) do contributions[#contributions + 1] = contribution_view(row) end
  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return contributions, next_cursor
end

function handle()
  keys_only(params, { authors = true, sortDirection = true, limit = true, cursor = true })
  local authors = contribution_authors()
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, valid_contribution_uri)
  local contributions, next_cursor = query_contributions(authors, limit, cursor, direction)
  local response = { contributions = toarray(contributions) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
