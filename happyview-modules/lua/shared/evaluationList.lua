local function evaluation_filter_values(key, format)
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

local function bind_evaluation_values(values, items)
  local placeholders = {}
  for _, item in ipairs(items) do
    values[#values + 1] = item
    placeholders[#placeholders + 1] = "$" .. #values
  end
  return placeholders
end

local function evaluation_evaluator_match(values, dids)
  local marks = bind_evaluation_values(values, dids)
  local source = "CASE WHEN jsonb_typeof(evaluation.record::jsonb->'evaluators') = 'array' " ..
    "THEN evaluation.record::jsonb->'evaluators' ELSE '[]'::jsonb END"
  return "EXISTS (SELECT 1 FROM jsonb_array_elements(" .. source .. ") AS evaluator(value) " ..
    "WHERE evaluator.value->>'did' IN (" .. table.concat(marks, ", ") .. "))"
end

local function evaluation_list_filters(authors, evaluators, subjects)
  local where, values = { "evaluation.collection = $1" }, { EVALUATION }
  if authors then add_in(where, values, "evaluation.did", authors) end
  if evaluators then
    if #evaluators == 0 then
      where[#where + 1] = "FALSE"
    else
      where[#where + 1] = evaluation_evaluator_match(values, evaluators)
    end
  end
  if subjects then add_in(where, values, "evaluation.record::jsonb->'subject'->>'uri'", subjects) end
  return where, values
end

local function evaluation_list_page_query(values, where, cursor, limit, direction)
  local page_values, page_where = {}, {}
  for _, value in ipairs(values) do page_values[#page_values + 1] = value end
  for _, clause in ipairs(where) do page_where[#page_where + 1] = clause end
  if cursor then
    page_values[#page_values + 1] = cursor.t
    local timestamp = "$" .. #page_values
    page_values[#page_values + 1] = cursor.u
    local uri = "$" .. #page_values
    local operator = direction == "asc" and ">" or "<"
    page_where[#page_where + 1] = "(sorted.sort_at, evaluation.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  page_values[#page_values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT evaluation.uri, evaluation.did, evaluation.cid, " ..
    "evaluation.indexed_at::text AS indexed_at, evaluation.record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', " ..
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS evaluation CROSS JOIN LATERAL (SELECT " ..
    created_at_sort("evaluation") .. " AS sort_at) AS sorted WHERE " .. table.concat(page_where, " AND ") ..
    " ORDER BY sorted.sort_at " .. ordering .. ", evaluation.uri " .. ordering .. " LIMIT $" .. #page_values
  return sql, page_values
end

local function evaluation_list_scan_batch(rows, views, limit)
  local last_scanned
  for index = 1, math.min(#rows, limit) do
    local row = rows[index]
    last_scanned = row
    local view = evaluation_view(row, true)
    if view then views[#views + 1] = view end
    if #views == limit then break end
  end
  return last_scanned, #views == limit
end

local function evaluation_list_query(authors, evaluators, subjects, limit, cursor, direction)
  local where, values = evaluation_list_filters(authors, evaluators, subjects)
  local views, next_cursor = {}, nil
  -- Bound work when many indexed rows are unrepresentable; the cursor lets callers continue.
  for batch = 1, 10 do
    local sql, page_values = evaluation_list_page_query(values, where, cursor, limit, direction)
    local rows = evaluation_query(sql, page_values)
    local last_scanned, limit_reached = evaluation_list_scan_batch(rows, views, limit)
    if not last_scanned then break end
    cursor = { t = last_scanned.sort_timestamp, u = last_scanned.uri }
    if limit_reached then
      if #rows > limit then
        next_cursor = cursor_encode({ v = 1, d = direction, t = cursor.t, u = cursor.u })
      end
      break
    end
    if #rows <= limit then break end
    if batch == 10 then
      next_cursor = cursor_encode({ v = 1, d = direction, t = cursor.t, u = cursor.u })
    end
  end
  hydrate_evaluation_views(views)
  return views, next_cursor
end

local function list_evaluations()
  keys_only(params, {
    authors = true,
    evaluators = true,
    subjects = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  })

  local authors = evaluation_filter_values("authors", "did")
  local evaluators = evaluation_filter_values("evaluators", "did")
  local subjects = evaluation_filter_values("subjects", "at-uri")
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, EVALUATION)
  local evaluations, next_cursor = evaluation_list_query(authors, evaluators, subjects, limit, cursor, direction)

  local response = { evaluations = toarray(evaluations) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
