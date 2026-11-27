local function measurement_array(key, format)
  local value = params[key]
  if value == nil then return nil end

  local supplied = {}
  if type(value) == "string" then
    supplied[1] = value
  elseif type(value) == "table" then
    local count = 0
    for index in pairs(value) do
      if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
        invalid(key .. " must use repeated query values")
      end
      count = count + 1
    end
    if count ~= #value then invalid(key .. " must use repeated query values") end
    for index = 1, count do
      if type(value[index]) ~= "string" then invalid(key .. " entries must be strings") end
      supplied[#supplied + 1] = value[index]
    end
  else
    invalid(key .. " must be a string or repeated string parameter")
  end
  if #supplied > 100 then invalid(key .. " accepts at most 100 values") end

  local unique, seen = {}, {}
  for _, item in ipairs(supplied) do
    if format == "did" and not valid_did(item) then
      invalid("each " .. key .. " value must be a valid DID")
    elseif format == "at-uri" then
      local valid, collection = valid_record_uri(item)
      if not valid or not valid_nsid(collection) then
        invalid("each " .. key .. " value must be a full AT-URI with a DID authority and valid collection NSID")
      end
    end
    if not seen[item] then
      seen[item] = true
      unique[#unique + 1] = item
    end
  end
  return unique
end

local function bind_values(values, items)
  local placeholders = {}
  for _, item in ipairs(items) do
    values[#values + 1] = item
    placeholders[#placeholders + 1] = "$" .. #values
  end
  return placeholders
end

local function measurement_list_query(authors, subjects, limit, cursor, direction)
  local where, values = { "measurement.collection = $1" }, { MEASUREMENT }
  if authors then add_in(where, values, "measurement.did", authors) end
  if subjects then
    if #subjects == 0 then
      where[#where + 1] = "FALSE"
    else
      local source = "CASE WHEN jsonb_typeof(measurement.record::jsonb->'subjects') = 'array' " ..
        "THEN measurement.record::jsonb->'subjects' ELSE '[]'::jsonb END"
      local placeholders = bind_values(values, subjects)
      where[#where + 1] = "EXISTS (SELECT 1 FROM jsonb_array_elements(" .. source .. ") AS subject(value) " ..
        "WHERE subject.value->>'uri' IN (" .. table.concat(placeholders, ", ") .. "))"
    end
  end

  local page_values, page_where = {}, {}
  for _, value in ipairs(values) do page_values[#page_values + 1] = value end
  for _, clause in ipairs(where) do page_where[#page_where + 1] = clause end
  if cursor then
    page_values[#page_values + 1] = cursor.t
    local timestamp = "$" .. #page_values
    page_values[#page_values + 1] = cursor.u
    local uri = "$" .. #page_values
    local operator = direction == "asc" and ">" or "<"
    page_where[#page_where + 1] = "(sorted.sort_at, measurement.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  page_values[#page_values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT measurement.uri, measurement.did, measurement.cid, " ..
    "measurement.indexed_at::text AS indexed_at, measurement.record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS measurement CROSS JOIN LATERAL (SELECT " ..
    created_at_sort("measurement") .. " AS sort_at) AS sorted WHERE " .. table.concat(page_where, " AND ") ..
    " ORDER BY sorted.sort_at " .. ordering .. ", measurement.uri " .. ordering .. " LIMIT $" .. #page_values
  local rows = measurement_query(sql, page_values)

  local measurements = {}
  local included = math.min(#rows, limit)
  for index = 1, included do measurements[#measurements + 1] = measurement_view(rows[index]) end

  local next_cursor
  if #rows > limit then
    local last = rows[limit]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  hydrate_measurement_views(measurements)
  return measurements, next_cursor
end

function handle()
  keys_only(params, {
    authors = true,
    subjects = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  })

  local authors = measurement_array("authors", "did")
  local subjects = measurement_array("subjects", "at-uri")
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, MEASUREMENT)
  local measurements, next_cursor = measurement_list_query(authors, subjects, limit, cursor, direction)

  local response = { measurements = toarray(measurements) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
