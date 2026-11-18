local function contribution_authors()
  local value = params.authors
  if value == nil then return nil end

  local supplied = {}
  if type(value) == "string" then
    supplied[1] = value
  elseif type(value) == "table" then
    local count = 0
    for index in pairs(value) do
      if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
        invalid("authors must use repeated query values")
      end
      count = count + 1
    end
    if count ~= #value then invalid("authors must use repeated query values") end
    for index = 1, count do
      if type(value[index]) ~= "string" then invalid("authors entries must be strings") end
      supplied[#supplied + 1] = value[index]
    end
  else
    invalid("authors must be a string or repeated string parameter")
  end
  if #supplied > 100 then invalid("authors accepts at most 100 values") end

  local authors, seen = {}, {}
  for _, did in ipairs(supplied) do
    if not valid_did(did) then invalid("each authors value must be a valid DID; resolve handles to DIDs first") end
    if not seen[did] then
      seen[did] = true
      authors[#authors + 1] = did
    end
  end
  return authors
end

local function decode_contribution_cursor(token, direction)
  return decode_cursor(token, direction, function(value)
    local valid = valid_contribution_uri(value.u)
    return valid and valid_datetime(value.t)
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
  local cursor = decode_contribution_cursor(scalar(params, "cursor"), direction)
  local contributions, next_cursor = query_contributions(authors, limit, cursor, direction)
  local response = { contributions = toarray(contributions) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
