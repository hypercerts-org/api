-- Hydrates page rows through the shared actor lookup, keeping this API's error
-- mapping. Rows are unique per DID, so the result keeps row order.
local function organization_actors(rows)
  local dids = {}
  for index, row in ipairs(rows) do dids[index] = row.did end
  return lookup_actors(dids, query)
end

local function valid_organization_uri(value)
  local valid, collection = valid_record_uri(value)
  -- The record key is the last path segment, so this suffix means rkey == "self".
  return valid and collection == ORGANIZATION and value:sub(-5) == "/self"
end

local function organization_filter_values(params, key)
  local supplied = query_string_values(params, key)
  if not supplied then return nil end
  return unique_query_values(supplied, function(item)
    if key == "actors" and not valid_did(item) then invalid("each actors value must be a valid DID") end
    if key == "organizationTypes" and #item > 128 then
      invalid("each organizationTypes value must be at most 128 characters")
    end
  end)
end

local function add_organization_types(where, values, organization_types)
  if not organization_types then return end
  if #organization_types == 0 then where[#where + 1] = "FALSE"; return end
  local placeholders = {}
  for _, organization_type in ipairs(organization_types) do
    values[#values + 1] = organization_type
    placeholders[#placeholders + 1] = "$" .. #values
  end
  local array_value = "CASE WHEN jsonb_typeof(organization.record::jsonb->'organizationType') = 'array' " ..
    "THEN organization.record::jsonb->'organizationType' ELSE '[]'::jsonb END"
  where[#where + 1] = "EXISTS (SELECT 1 FROM jsonb_array_elements_text(" .. array_value ..
    ") AS organization_type(value) WHERE organization_type.value IN (" .. table.concat(placeholders, ", ") .. "))"
end

local function query_organizations(actors, organization_types, visibility, search, limit, cursor, direction)
  local where, values = { "organization.collection = $1", "organization.rkey = 'self'" }, { ORGANIZATION }
  if actors then add_in(where, values, "organization.did", actors) end
  add_organization_types(where, values, organization_types)
  if visibility ~= nil then
    values[#values + 1] = visibility
    where[#where + 1] = "organization.record::jsonb->>'visibility' = $" .. #values
  end
  if search then
    values[#values + 1] = search
    local search_parameter = "$" .. #values
    values[#values + 1] = PROFILE
    local profile_collection = "$" .. #values
    where[#where + 1] = "(strpos(lower(COALESCE(organization.record::jsonb->>'legalName', '')), lower(" ..
      search_parameter .. ")) > 0 OR EXISTS (SELECT 1 FROM happyview_records AS profile " ..
      "WHERE profile.collection = " .. profile_collection .. " AND profile.did = organization.did " ..
      "AND profile.rkey = 'self' AND (strpos(lower(COALESCE(profile.record::jsonb->>'displayName', '')), lower(" ..
      search_parameter .. ")) > 0 OR strpos(lower(COALESCE(profile.record::jsonb->>'description', '')), lower(" ..
      search_parameter .. ")) > 0)))"
  end
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, uri) " .. operator .. " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sort_key = created_at_sort("organization")
  local sql = "SELECT organization.uri, organization.did, organization.cid, organization.indexed_at::text AS indexed_at, " ..
    "organization.record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS organization CROSS JOIN LATERAL (SELECT " .. sort_key .. " AS sort_at) AS sorted WHERE " ..
    table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering .. ", uri " .. ordering .. " LIMIT $" .. #values
  local rows = query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local actors_result = organization_actors(rows)
  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return actors_result, next_cursor
end

local function organizations_response(search_enabled)
  local allowed = {
    organizationTypes = true,
    visibility = true,
    sortDirection = true,
    limit = true,
    cursor = true,
  }
  if search_enabled then
    allowed.actors = true
    allowed.search = true
  end
  keys_only(params, allowed)

  local actors
  if search_enabled then actors = organization_filter_values(params, "actors") end
  local organization_types = organization_filter_values(params, "organizationTypes")
  local visibility = scalar(params, "visibility")
  local search
  if search_enabled then
    search = scalar(params, "search")
    if search == nil then invalid("search is required") end
    search = search:match("^%s*(.-)%s*$")
    if search == "" then search = nil end
  end

  local limit = parse_list_limit(params)

  local direction = parse_sort_direction(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, valid_organization_uri)
  local actors_result, next_cursor = query_organizations(actors, organization_types, visibility, search, limit, cursor, direction)
  local response = { actors = toarray(actors_result) }
  if next_cursor then response.cursor = next_cursor end
  return response
end
