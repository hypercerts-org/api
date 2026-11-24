local function valid_funding_record_uri(value)
  local valid, collection = valid_record_uri(value)
  if not valid or not valid_nsid(collection) then return false, collection end
  return true, collection
end

local function funding_receipt_array(key, format)
  local value = params[key]
  if value == nil then return nil end

  local supplied, occurrences = {}, 0
  if type(value) == "string" then
    supplied[1] = value
  elseif type(value) == "table" then
    for index in pairs(value) do
      if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
        invalid(key .. " must use repeated query values")
      end
      occurrences = occurrences + 1
    end
    if occurrences ~= #value then invalid(key .. " must use repeated query values") end
    for index = 1, occurrences do
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
      invalid(key .. " entry " .. string.format("%q", item) .. " must be a valid DID")
    elseif format == "receiptUri" then
      local valid, collection = valid_funding_record_uri(item)
      if not valid or collection ~= RECEIPT then
        invalid(key .. " entry " .. string.format("%q", item) ..
          " must be a full org.hypercerts.funding.receipt AT-URI with a DID authority")
      end
    elseif format == "atUri" then
      local valid = valid_funding_record_uri(item)
      if not valid then
        invalid(key .. " entry " .. string.format("%q", item) ..
          " must be a full record AT-URI with a valid NSID collection and DID authority")
      end
    elseif format == "party" and not valid_did(item) then
      local valid = valid_funding_record_uri(item)
      if not valid then
        invalid(key .. " entry " .. string.format("%q", item) ..
          " must be a valid DID or full record AT-URI; resolve handles to DIDs before querying")
      end
    end

    if not seen[item] then
      seen[item] = true
      unique[#unique + 1] = item
    end
  end
  return unique
end

local function decode_funding_receipt_cursor(token, direction)
  return decode_cursor(token, direction, function(value)
    local valid, collection = valid_record_uri(value.u)
    return valid_datetime(value.t) and valid and collection == RECEIPT
  end)
end

local function bind_funding_receipt_values(values, items)
  local placeholders = {}
  for _, item in ipairs(items) do
    values[#values + 1] = item
    placeholders[#placeholders + 1] = "$" .. #values
  end
  return placeholders
end

local function add_funding_receipt_array_filter(where, values, items, expression)
  if items ~= nil then add_in(where, values, expression, items) end
end

local function add_funding_receipt_party_filter(where, values, key, items)
  if items == nil then return end
  if #items == 0 then where[#where + 1] = "FALSE"; return end

  local dids, uris = {}, {}
  for _, item in ipairs(items) do
    if valid_did(item) then dids[#dids + 1] = item else uris[#uris + 1] = item end
  end
  local record_party = "receipt.record::jsonb->'" .. key .. "'"
  local matches = {}
  if #dids > 0 then
    local did_marks = bind_funding_receipt_values(values, dids)
    matches[#matches + 1] = "(" .. record_party .. "->>'$type' = 'app.certified.defs#did' AND " ..
      record_party .. "->>'did' IN (" .. table.concat(did_marks, ", ") .. "))"
  end
  if #uris > 0 then
    local uri_marks = bind_funding_receipt_values(values, uris)
    matches[#matches + 1] = "(" .. record_party .. "->>'$type' = 'com.atproto.repo.strongRef' AND " ..
      record_party .. "->>'uri' IN (" .. table.concat(uri_marks, ", ") .. "))"
  end
  where[#where + 1] = "(" .. table.concat(matches, " OR ") .. ")"
end

local function query_funding_receipts(authors, uris, from_values, to_values, for_uris, transaction_ids, limit, cursor, direction, include_total)
  local where, values = { "receipt.collection = $1" }, { RECEIPT }
  add_funding_receipt_array_filter(where, values, authors, "receipt.did")
  add_funding_receipt_array_filter(where, values, uris, "receipt.uri")
  add_funding_receipt_party_filter(where, values, "from", from_values)
  add_funding_receipt_party_filter(where, values, "to", to_values)
  add_funding_receipt_array_filter(where, values, for_uris, "receipt.record::jsonb->'for'->>'uri'")
  add_funding_receipt_array_filter(where, values, transaction_ids, "receipt.record::jsonb->>'transactionId'")

  local filter_sql = include_total and table.concat(where, " AND ")
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, receipt.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT " .. (include_total and "sorted.sort_at AS sort_at, " or "") ..
    "receipt.uri, receipt.did, receipt.cid, receipt.indexed_at::text AS indexed_at, " ..
    "receipt.record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', " ..
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS receipt CROSS JOIN LATERAL (SELECT " ..
    created_at_sort("receipt") .. " AS sort_at) AS sorted WHERE " .. table.concat(where, " AND ") ..
    " ORDER BY sorted.sort_at " .. ordering .. ", receipt.uri " .. ordering .. " LIMIT $" .. #values
  if include_total then
    sql = "WITH total AS (SELECT COUNT(*) AS total_count FROM happyview_records AS receipt WHERE " .. filter_sql ..
      "), page AS (" .. sql .. ") " ..
      "SELECT page.uri, page.did, page.cid, page.indexed_at, page.record, page.sort_timestamp, total.total_count " ..
      "FROM total LEFT JOIN page ON TRUE ORDER BY page.sort_at " .. ordering .. ", page.uri " .. ordering
  end
  local rows = receipt_query(sql, values)
  local total_count
  if include_total then
    total_count = rows[1] and tonumber(rows[1].total_count)
    if not total_count or total_count < 0 or total_count > 9007199254740991 or total_count % 1 ~= 0 then
      error("ReceiptQueryFailed: receipt count unavailable", 0)
    end
    if rows[1].uri == nil then rows = {} end
  end
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local receipts = {}
  for _, row in ipairs(rows) do receipts[#receipts + 1] = funding_receipt_view(row) end
  hydrate_funding_receipt_views(receipts)

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return receipts, next_cursor, total_count
end

local function funding_receipts_response()
  keys_only(params, {
    authors = true,
    uris = true,
    from = true,
    to = true,
    forUris = true,
    transactionIds = true,
    includeTotal = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  })

  local authors = funding_receipt_array("authors", "did")
  local uris = funding_receipt_array("uris", "receiptUri")
  local from_values = funding_receipt_array("from", "party")
  local to_values = funding_receipt_array("to", "party")
  local for_uris = funding_receipt_array("forUris", "atUri")
  local transaction_ids = funding_receipt_array("transactionIds")

  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = decode_funding_receipt_cursor(scalar(params, "cursor"), direction)
  local include_total = params.includeTotal
  if include_total ~= nil and type(include_total) ~= "boolean" then
    local value = scalar(params, "includeTotal")
    if value ~= "true" and value ~= "false" then invalid("includeTotal must be true or false") end
    include_total = value == "true"
  end
  local receipts, next_cursor, total_count = query_funding_receipts(
    authors, uris, from_values, to_values, for_uris, transaction_ids, limit, cursor, direction, include_total)
  local response = { receipts = toarray(receipts), totalCount = total_count }
  if next_cursor then response.cursor = next_cursor end
  return response
end
