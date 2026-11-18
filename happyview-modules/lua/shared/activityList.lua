local function activity_scalar(values, key)
  if key == "hasOrganizationRecord" and type(values[key]) == "boolean" then
    return tostring(values[key])
  end
  return scalar(values, key)
end

local function activity_array(key, format)
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
      invalid("each " .. key .. " value must be a valid DID; resolve handles to DIDs first")
    elseif format == "activityUri" then
      local valid, collection = valid_record_uri(item)
      if not valid or collection ~= ACTIVITY then
        invalid("each uris value must be a full org.hypercerts.claim.activity AT-URI with a DID authority")
      end
    end
    if not seen[item] then
      seen[item] = true
      unique[#unique + 1] = item
    end
  end
  return unique
end

local function decode_activity_cursor(token, direction)
  return decode_cursor(token, direction, function(value)
    local valid, collection = valid_record_uri(value.u)
    return valid_datetime(value.t) and valid and collection == ACTIVITY
  end)
end

local function bind_values(values, items)
  local placeholders = {}
  for _, item in ipairs(items) do
    values[#values + 1] = item
    placeholders[#placeholders + 1] = "$" .. #values
  end
  return placeholders
end

local function activity_contributor_match(values, dids)
  local marks = bind_values(values, dids)
  local set = table.concat(marks, ", ")
  local identity = "contributor.value->'contributorIdentity'->>'identity'"
  local information_identifier = "ci.record::jsonb->>'identifier'"
  return "EXISTS (SELECT 1 FROM jsonb_array_elements(" ..
    "CASE WHEN jsonb_typeof(activity.record::jsonb->'contributors') = 'array' " ..
    "THEN activity.record::jsonb->'contributors' ELSE '[]'::jsonb END) AS contributor(value) " ..
    "LEFT JOIN happyview_records AS ci ON ci.collection = 'org.hypercerts.claim.contributorInformation' " ..
    "AND ci.uri = (contributor.value->'contributorIdentity'->>'uri') " ..
    "AND ci.cid = (contributor.value->'contributorIdentity'->>'cid') " ..
    "WHERE (" .. identity .. " IN (" .. set .. ") " ..
    "OR substring(" .. identity .. " from '^at://([^/]+)/') IN (" .. set .. ") " ..
    "OR " .. information_identifier .. " IN (" .. set .. ") " ..
    "OR substring(" .. information_identifier .. " from '^at://([^/]+)/') IN (" .. set .. ")))"
end

local function activity_query(authors, has_organization_record, contributors, involved_actors, uris, search, limit, cursor, direction)
  local where, values = { "activity.collection = $1" }, { ACTIVITY }
  if authors then add_in(where, values, "activity.did", authors) end
  if has_organization_record ~= nil then
    local predicate = has_organization_record and "EXISTS" or "NOT EXISTS"
    where[#where + 1] = predicate .. " (SELECT 1 FROM happyview_records AS organization " ..
      "WHERE organization.collection = 'app.certified.actor.organization' AND organization.rkey = 'self' " ..
      "AND organization.did = activity.did)"
  end
  if contributors then
    if #contributors == 0 then where[#where + 1] = "FALSE"
    else where[#where + 1] = activity_contributor_match(values, contributors) end
  end
  if involved_actors then
    if #involved_actors == 0 then
      where[#where + 1] = "FALSE"
    else
      local marks = bind_values(values, involved_actors)
      where[#where + 1] = "(activity.did IN (" .. table.concat(marks, ", ") .. ") OR " ..
        activity_contributor_match(values, involved_actors) .. ")"
    end
  end
  if uris then add_in(where, values, "activity.uri", uris) end
  if search ~= nil then
    values[#values + 1] = search
    local pattern = "$" .. #values
    where[#where + 1] = "(strpos(lower(COALESCE(activity.record::jsonb->>'title', '')), lower(" .. pattern .. ")) > 0 " ..
      "OR strpos(lower(COALESCE(activity.record::jsonb->>'shortDescription', '')), lower(" .. pattern .. ")) > 0)"
  end
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, activity.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT activity.uri, activity.did, activity.cid, activity.indexed_at::text AS indexed_at, " ..
    "activity.record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', " ..
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS activity CROSS JOIN LATERAL (SELECT " .. created_at_sort("activity") .. " AS sort_at) AS sorted " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", activity.uri " .. ordering .. " LIMIT $" .. #values
  local rows = query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local views = {}
  for _, row in ipairs(rows) do views[#views + 1] = activity_view(row) end
  hydrate_activity_views(views)

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end

local function activity_list_response(search_enabled)
  local allowed = {
    authors = true,
    hasOrganizationRecord = true,
    contributors = true,
    involvedActors = true,
    uris = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  }
  if search_enabled then allowed.search = true end
  keys_only(params, allowed, "unknown query parameter: ")

  local authors = activity_array("authors", "did")
  local has_organization_record = activity_scalar(params, "hasOrganizationRecord")
  if has_organization_record ~= nil then
    if has_organization_record == "true" then
      has_organization_record = true
    elseif has_organization_record == "false" then
      has_organization_record = false
    else
      invalid("hasOrganizationRecord must be true or false")
    end
  end
  local contributors = activity_array("contributors", "did")
  local involved_actors = activity_array("involvedActors", "did")
  local uris = activity_array("uris", "activityUri")
  local search
  if search_enabled then
    search = scalar(params, "search")
    if search == nil then invalid("search is required") end
    search = search:match("^%s*(.-)%s*$")
    if search == "" then search = nil end
  end
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = decode_activity_cursor(scalar(params, "cursor"), direction)
  local activities, next_cursor = activity_query(
    authors, has_organization_record, contributors, involved_actors, uris, search, limit, cursor, direction)
  local response = { activities = toarray(activities) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
