local function attachment_filter_values(params, key, validate, description)
  local supplied = query_string_values(params, key)
  if not supplied then return nil end
  return unique_query_values(supplied, function(item)
    if validate and not validate(item) then invalid("each " .. key .. " value must be " .. description) end
  end)
end

local function attachment_subject_filter(where, values, subjects)
  if not subjects then return end
  if #subjects == 0 then
    where[#where + 1] = "FALSE"
    return
  end
  local placeholders = {}
  for _, subject in ipairs(subjects) do
    values[#values + 1] = subject
    placeholders[#placeholders + 1] = "$" .. #values
  end
  where[#where + 1] = "EXISTS (SELECT 1 FROM jsonb_array_elements(" ..
    "CASE WHEN jsonb_typeof(attachment.record::jsonb->'subjects') = 'array' " ..
    "THEN attachment.record::jsonb->'subjects' ELSE '[]'::jsonb END) AS subject(value) " ..
    "WHERE subject.value->>'uri' IN (" .. table.concat(placeholders, ", ") .. "))"
end

local function query_attachments(filters, limit, cursor, direction)
  local where, values = { "attachment.collection = $1" }, { ATTACHMENT_COLLECTION }
  if filters.authors then add_in(where, values, "attachment.did", filters.authors) end
  if filters.uris then add_in(where, values, "attachment.uri", filters.uris) end
  attachment_subject_filter(where, values, filters.subjects)
  if filters.content_types then
    add_in(where, values, "attachment.record::jsonb->>'contentType'", filters.content_types)
  end

  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, attachment.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sort_key = created_at_sort("attachment")
  local sql = "SELECT attachment.uri, attachment.did, attachment.cid, attachment.indexed_at::text AS indexed_at, " ..
    "attachment.record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', " ..
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS attachment CROSS JOIN LATERAL (SELECT " .. sort_key .. " AS sort_at) AS sorted " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", attachment.uri " .. ordering .. " LIMIT $" .. #values
  local rows = attachment_query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local views = {}
  for _, row in ipairs(rows) do views[#views + 1] = attachment_view(row) end
  hydrate_attachment_views(views)

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end

local function list_attachments()
  keys_only(params, {
    authors = true,
    uris = true,
    subjects = true,
    contentTypes = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  })
  local authors = attachment_filter_values(params, "authors", valid_did, "valid DIDs")
  local uris = attachment_filter_values(params, "uris", valid_attachment_uri,
    "full org.hypercerts.context.attachment AT-URIs with DID authorities")
  local subjects = attachment_filter_values(params, "subjects", function(value)
    return valid_record_uri(value)
  end, "full AT-URIs with DID authorities")
  local content_types = attachment_filter_values(params, "contentTypes")
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, valid_attachment_uri)
  local attachments, next_cursor = query_attachments({
    authors = authors,
    uris = uris,
    subjects = subjects,
    content_types = content_types,
  }, limit, cursor, direction)
  local response = { attachments = toarray(attachments) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
