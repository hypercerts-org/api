local function collection_filter_values(key, kind)
  local supplied = query_string_values(params, key)
  if not supplied then return nil end
  return unique_query_values(supplied, function(item)
    if kind == "did" and not valid_did(item) then
      invalid("each authors value must be a valid DID; resolve handles to DIDs first")
    elseif kind == "collectionUri" then
      local valid, collection = valid_bounded_record_uri(item)
      if not valid or collection ~= COLLECTION then
        invalid("each uris value must be a full org.hypercerts.collection AT-URI with a DID authority")
      end
    elseif kind == "recordUri" then
      if not valid_bounded_record_uri(item) then
        invalid("each " .. key .. " value must be a full AT-URI with a DID authority")
      end
    elseif kind == "tagUri" then
      local valid, collection = valid_bounded_record_uri(item)
      if not valid or collection ~= "org.hypercerts.vocab.tag" then
        invalid("each tagUris value must be a full org.hypercerts.vocab.tag AT-URI with a DID authority")
      end
    elseif kind == "type" and #item > 64 then
      invalid("types entries must be at most 64 UTF-8 bytes")
    end
  end)
end

local function collection_bind_values(values, items)
  local placeholders = {}
  for _, item in ipairs(items) do
    values[#values + 1] = item
    placeholders[#placeholders + 1] = "$" .. #values
  end
  return placeholders
end

local function collection_list_filters(filters, search)
  local where, values = { "collection.collection = $1" }, { COLLECTION }

  if filters.authors then add_in(where, values, "collection.did", filters.authors) end
  if filters.hasOrganizationRecord ~= nil then
    local predicate = filters.hasOrganizationRecord and "EXISTS" or "NOT EXISTS"
    where[#where + 1] = predicate .. " (SELECT 1 FROM happyview_records AS organization " ..
      "WHERE organization.collection = 'app.certified.actor.organization' AND organization.rkey = 'self' " ..
      "AND organization.did = collection.did)"
  end
  if filters.types then add_in(where, values, "collection.record::jsonb->>'type'", filters.types) end
  if filters.uris then add_in(where, values, "collection.uri", filters.uris) end
  if filters.itemUris then
    if #filters.itemUris == 0 then
      where[#where + 1] = "FALSE"
    else
      local item_marks = collection_bind_values(values, filters.itemUris)
      where[#where + 1] = "EXISTS (SELECT 1 FROM jsonb_array_elements(" ..
        "CASE WHEN jsonb_typeof(collection.record::jsonb->'items') = 'array' " ..
        "THEN collection.record::jsonb->'items' ELSE '[]'::jsonb END) AS item(value) " ..
        "WHERE item.value->'itemIdentifier'->>'uri' IN (" .. table.concat(item_marks, ", ") .. "))"
    end
  end
  if filters.tagUris then
    for _, tag_uri in ipairs(filters.tagUris) do
      values[#values + 1] = tag_uri
      local tag_parameter = "$" .. #values
      where[#where + 1] = "EXISTS (SELECT 1 FROM jsonb_array_elements(" ..
        "CASE WHEN jsonb_typeof(collection.record::jsonb->'tags') = 'array' " ..
        "THEN collection.record::jsonb->'tags' ELSE '[]'::jsonb END) AS tag(value) " ..
        "WHERE tag.value->>'uri' = " .. tag_parameter .. ")"
    end
  end
  if search ~= nil then
    values[#values + 1] = search
    local text = "$" .. #values
    where[#where + 1] = "(strpos(lower(COALESCE(collection.record::jsonb->>'title', '')), lower(" .. text .. ")) > 0 " ..
      "OR strpos(lower(COALESCE(collection.record::jsonb->>'shortDescription', '')), lower(" .. text .. ")) > 0)"
  end
  return where, values
end

local function collection_list_apply_cursor(where, values, cursor, direction)
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, collection.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end
end

local function collection_list_sql(where, values, limit, direction, include_sort_at)
  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sort_key = created_at_sort("collection")
  return "SELECT " .. (include_sort_at and "sorted.sort_at AS sort_at, " or "") ..
    "collection.uri, collection.did, collection.cid, collection.indexed_at::text AS indexed_at, " ..
    "collection.record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', " ..
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS collection CROSS JOIN LATERAL (SELECT " .. sort_key .. " AS sort_at) AS sorted " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", collection.uri " .. ordering .. " LIMIT $" .. #values
end

local function collection_list_page(rows, limit, direction, include_total)
  local total_count
  if include_total then
    total_count = rows[1] and tonumber(rows[1].total_count)
    if not total_count or total_count < 0 or total_count > 9007199254740991 or total_count % 1 ~= 0 then
      error("CollectionQueryFailed: collection count unavailable", 0)
    end
    if rows[1].uri == nil then rows = {} end
  end
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local views = {}
  for _, row in ipairs(rows) do views[#views + 1] = collection_view(row) end
  -- A malformed sidecar reference must not discard a collection page or its cursor.
  collection_hydrate(views, true)

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor, total_count
end

local function collection_list_query(filters, search, limit, cursor, direction, include_total)
  local where, values = collection_list_filters(filters, search)
  local filter_sql = table.concat(where, " AND ")
  collection_list_apply_cursor(where, values, cursor, direction)
  local page_sql = collection_list_sql(where, values, limit, direction, include_total)
  local sql = page_sql
  if include_total then
    local ordering = direction == "asc" and "ASC" or "DESC"
    sql = "WITH total AS (SELECT COUNT(*) AS total_count FROM happyview_records AS collection WHERE " .. filter_sql .. "), " ..
      "page AS (" .. page_sql .. ") " ..
      "SELECT page.uri, page.did, page.cid, page.indexed_at, page.record, page.sort_timestamp, total.total_count " ..
      "FROM total LEFT JOIN page ON TRUE ORDER BY page.sort_at " .. ordering .. ", page.uri " .. ordering
  end
  return collection_list_page(collection_query(sql, values), limit, direction, include_total)
end

local function collection_list_response(search_enabled)
  local allowed = {
    authors = true,
    hasOrganizationRecord = true,
    types = true,
    uris = true,
    itemUris = true,
    tagUris = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  }
  if search_enabled then allowed.search = true else allowed.includeTotal = true end
  keys_only(params, allowed, "unknown query parameter: ")

  local authors = collection_filter_values("authors", "did")
  local has_organization_record = scalar_or_boolean(params, "hasOrganizationRecord")
  if has_organization_record ~= nil then
    if has_organization_record == "true" then
      has_organization_record = true
    elseif has_organization_record == "false" then
      has_organization_record = false
    else
      invalid("hasOrganizationRecord must be true or false")
    end
  end
  local types = collection_filter_values("types", "type")
  local uris = collection_filter_values("uris", "collectionUri")
  local item_uris = collection_filter_values("itemUris", "recordUri")
  local tag_uris = collection_filter_values("tagUris", "tagUri")
  local search
  if search_enabled then
    search = scalar(params, "search")
    if search == nil then invalid("search is required") end
    search = search:match("^%s*(.-)%s*$")
    if search == "" then search = nil end
  end
  local include_total = false
  if not search_enabled then include_total = parse_include_total(params) end
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, COLLECTION)
  local collections, next_cursor, total_count = collection_list_query({
    authors = authors,
    hasOrganizationRecord = has_organization_record,
    types = types,
    uris = uris,
    itemUris = item_uris,
    tagUris = tag_uris,
  }, search, limit, cursor, direction, include_total)
  local response = { collections = toarray(collections) }
  if next_cursor then response.cursor = next_cursor end
  if include_total then response.totalCount = total_count end
  return response
end
