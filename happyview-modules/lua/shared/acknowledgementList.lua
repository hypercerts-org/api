local function valid_cursor_timestamp(value)
  if type(value) ~= "string" or #value ~= 27
    or not value:match("^%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%d%.%d%d%d%d%d%dZ$") then
    return false
  end
  return valid_datetime(value)
end

local function acknowledgement_filter_values(key, format)
  local supplied = query_string_values(params, key)
  if not supplied then return nil end
  return unique_query_values(supplied, function(item)
    if format == "did" and not valid_did(item) then
      invalid("each " .. key .. " value must be a valid DID; resolve handles to DIDs first")
    elseif format == "at-uri" then
      local valid, collection = valid_record_uri(item)
      if not valid or not valid_nsid(collection) then
        invalid("each " .. key .. " value must be a full AT-URI with a DID authority and valid collection NSID")
      end
    end
  end)
end

local function acknowledgement_sort_expression()
  local created = "acknowledgement.record::jsonb->>'createdAt'"
  local pattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  local record_timestamp = "CASE WHEN jsonb_typeof(acknowledgement.record::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. pattern .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE NULL END"
  return "COALESCE(" .. record_timestamp .. ", acknowledgement.indexed_at::timestamptz, " ..
    "acknowledgement.created_at::timestamptz)"
end

local function acknowledgement_list_query(authors, subjects, limit, cursor, direction)
  local where, values = { "acknowledgement.collection = $1" }, { ACKNOWLEDGEMENT }
  if authors then add_in(where, values, "acknowledgement.did", authors) end
  if subjects then add_in(where, values, "acknowledgement.record::jsonb->'subject'->>'uri'", subjects) end

  local page_values, page_where = {}, {}
  for _, value in ipairs(values) do page_values[#page_values + 1] = value end
  for _, clause in ipairs(where) do page_where[#page_where + 1] = clause end
  if cursor then
    page_values[#page_values + 1] = cursor.t
    local timestamp = "$" .. #page_values
    page_values[#page_values + 1] = cursor.u
    local uri = "$" .. #page_values
    local operator = direction == "asc" and ">" or "<"
    page_where[#page_where + 1] = "(sorted.sort_at, acknowledgement.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end
  page_values[#page_values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT acknowledgement.uri, acknowledgement.did, acknowledgement.cid, " ..
    "acknowledgement.indexed_at::text AS indexed_at, acknowledgement.record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS acknowledgement CROSS JOIN LATERAL (SELECT " ..
    acknowledgement_sort_expression() .. " AS sort_at) AS sorted WHERE " ..
    table.concat(page_where, " AND ") .. " " ..
    "ORDER BY sorted.sort_at " .. ordering .. ", acknowledgement.uri " .. ordering .. " LIMIT $" .. #page_values
  return acknowledgement_query(sql, page_values)
end

local function list_acknowledgements()
  keys_only(params, {
    authors = true,
    subjects = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  })
  local authors = acknowledgement_filter_values("authors", "did")
  local subjects = acknowledgement_filter_values("subjects", "at-uri")
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, ACKNOWLEDGEMENT, valid_cursor_timestamp)
  local rows = acknowledgement_list_query(authors, subjects, limit, cursor, direction)
  local acknowledgements = {}
  for index = 1, math.min(#rows, limit) do
    acknowledgements[#acknowledgements + 1] = record_view(rows[index])
  end
  if #acknowledgements > 0 then hydrate_acknowledgement_authors(acknowledgements) end

  local response = { acknowledgements = toarray(acknowledgements) }
  if #rows > limit then
    local last = rows[limit]
    response.cursor = cursor_encode({
      v = 1,
      d = direction,
      t = last.sort_timestamp,
      u = last.uri,
    })
  end
  return response
end
