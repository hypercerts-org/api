local function valid_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
end

local function valid_record_key(value)
  return #value >= 1 and #value <= 512 and value ~= "." and value ~= ".."
    and not value:find("[^%w_~%.:%-]")
end

local function valid_record_uri(value)
  if type(value) ~= "string" or value:find("[?#]") then return false end
  local authority, collection, rkey = value:match("^at://([^/]+)/([^/]+)/([^/]+)$")
  if not authority or not valid_did(authority) or not valid_record_key(rkey) then return false end
  return true, collection, authority
end

-- luacheck: push ignore 211
-- For user-supplied filter values: bounds the size before parsing.
local function valid_bounded_record_uri(value)
  if type(value) ~= "string" or #value > 8192 then return false end
  return valid_record_uri(value)
end
-- luacheck: pop

local ACTIVITY_PROJECTION_CONTRIBUTOR_INFORMATION = "org.hypercerts.claim.contributorInformation"
local ACTIVITY_PROJECTION_PROFILE = "app.certified.actor.profile"
local ACTIVITY_PROJECTION_ORGANIZATION = "app.certified.actor.organization"
local ACTIVITY_PROJECTION_NULL = json.decode("null")

local function activity_projection_query(sql, values)
  if db.backend() ~= "postgres" then error("ActivityQueryFailed: activity API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ActivityQueryFailed: activity lookup failed", 0)
  end
  return result
end

local function activity_projection_record_view(row, nullable_indexed_at)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and nullable_indexed_at and ACTIVITY_PROJECTION_NULL or row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end

local function activity_projection_identity_did(identifier)
  if valid_did(identifier) then return identifier end
  local valid, _, authority = valid_record_uri(identifier)
  if valid then return authority end
  return nil
end

local function activity_projection_identity_key(uri, cid)
  return uri .. "\0" .. cid
end

local function activity_projection_load_contributor_information(references)
  local rows_by_version = {}
  for first = 1, #references, 500 do
    local values, predicates = { ACTIVITY_PROJECTION_CONTRIBUTOR_INFORMATION }, {}
    local last = math.min(first + 499, #references)
    for index = first, last do
      local reference = references[index]
      values[#values + 1] = reference.uri
      local uri_parameter = "$" .. #values
      values[#values + 1] = reference.cid
      local cid_parameter = "$" .. #values
      predicates[#predicates + 1] = "(uri = " .. uri_parameter .. " AND cid = " .. cid_parameter .. ")"
    end
    local rows = activity_projection_query(
      "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
        "FROM happyview_records WHERE collection = $1 AND (" .. table.concat(predicates, " OR ") .. ")",
      values)
    for _, row in ipairs(rows) do
      rows_by_version[activity_projection_identity_key(row.uri, row.cid)] = row
    end
  end
  return rows_by_version
end

local function activity_projection_load_actor_records(collection, dids)
  local by_did = {}
  for first = 1, #dids, 500 do
    local values, placeholders = { collection }, {}
    local last = math.min(first + 499, #dids)
    for index = first, last do
      values[#values + 1] = dids[index]
      placeholders[#placeholders + 1] = "$" .. #values
    end
    local rows = activity_projection_query(
      "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
        "FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(placeholders, ", ") .. ")",
      values)
    for _, row in ipairs(rows) do by_did[row.did] = row end
  end
  return by_did
end

local function activity_projection_add_unique(values, seen, value)
  if not seen[value] then
    seen[value] = true
    values[#values + 1] = value
  end
end

local function activity_projection_view(row)
  local record = json.decode(row.record)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and ACTIVITY_PROJECTION_NULL or row.indexed_at,
    did = row.did,
    author = { did = row.did },
    record = record,
  }
end

local function activity_projection_hydrate_views(views)
  local references, seen_references = {}, {}
  local author_dids, seen_authors = {}, {}
  local profile_dids, seen_profiles = {}, {}
  local projected_contributors, contributor_resolutions = {}, {}

  for view_index, view in ipairs(views) do
    activity_projection_add_unique(author_dids, seen_authors, view.did)
    activity_projection_add_unique(profile_dids, seen_profiles, view.did)
    local source_contributors = view.record.contributors
    if source_contributors ~= nil then
      if type(source_contributors) ~= "table" then
        error("ActivityQueryFailed: activity contributors are not an array", 0)
      end
      local projections = {}
      for _, source in ipairs(source_contributors) do
        if type(source) ~= "string" then
          local projection = {}
          for key, value in pairs(source) do projection[key] = value end
          projection.contributorInformation = ACTIVITY_PROJECTION_NULL
          projection.actor = ACTIVITY_PROJECTION_NULL
          projections[#projections + 1] = projection

          local identity = source.contributorIdentity
          local resolution = { projection = projection }
          if type(identity) == "table" and type(identity.uri) == "string" and type(identity.cid) == "string" then
            local key = activity_projection_identity_key(identity.uri, identity.cid)
            resolution.information_key = key
            if not seen_references[key] then
              seen_references[key] = true
              references[#references + 1] = { uri = identity.uri, cid = identity.cid }
            end
          elseif type(identity) == "table" then
            resolution.identifier = identity.identity
          end
          contributor_resolutions[#contributor_resolutions + 1] = resolution
        end
      end
      projected_contributors[view_index] = projections
    end
  end

  local contributor_information = activity_projection_load_contributor_information(references)
  for _, resolution in ipairs(contributor_resolutions) do
    local projection = resolution.projection
    local identifier = resolution.identifier
    if resolution.information_key then
      local row = contributor_information[resolution.information_key]
      if row then
        local information = activity_projection_record_view(row, true)
        projection.contributorInformation = information
        identifier = information.record.identifier
      end
    end
    local did = activity_projection_identity_did(identifier)
    if did then
      projection.actor = { did = did }
      activity_projection_add_unique(profile_dids, seen_profiles, did)
    end
  end

  local profiles = activity_projection_load_actor_records(ACTIVITY_PROJECTION_PROFILE, profile_dids)
  local organizations = activity_projection_load_actor_records(ACTIVITY_PROJECTION_ORGANIZATION, author_dids)
  for _, view in ipairs(views) do
    local author = view.author
    author.profile = profiles[author.did] and activity_projection_record_view(profiles[author.did]) or ACTIVITY_PROJECTION_NULL
    author.organization = organizations[author.did] and activity_projection_record_view(organizations[author.did]) or ACTIVITY_PROJECTION_NULL
  end
  for _, projections in pairs(projected_contributors) do
    for _, projection in ipairs(projections) do
      local actor = projection.actor
      if actor ~= ACTIVITY_PROJECTION_NULL then
        actor.profile = profiles[actor.did] and activity_projection_record_view(profiles[actor.did]) or ACTIVITY_PROJECTION_NULL
      end
    end
  end

  for view_index, projections in pairs(projected_contributors) do
    views[view_index].contributors = toarray(projections)
  end
end

local function invalid(message)
  error("InvalidRequest: " .. message, 0)
end

local function keys_only(values, allowed, unknown_message_prefix)
  for key in pairs(values) do
    if not allowed[key] then
      invalid(unknown_message_prefix and (unknown_message_prefix .. key) or "unknown query parameter")
    end
  end
end

local function scalar(params, key)
  local value = params[key]
  if value == nil then return nil end
  if type(value) ~= "string" and type(value) ~= "number" then
    invalid(key .. " must occur once")
  end
  return tostring(value)
end

-- luacheck: push ignore 211
-- Like scalar(), but a boolean comes back as "true" or "false": HappyView can hand
-- boolean-typed query parameters to Lua as booleans rather than strings.
local function scalar_or_boolean(values, key)
  if type(values[key]) == "boolean" then return tostring(values[key]) end
  return scalar(values, key)
end
-- luacheck: pop

local ACTIVITY = "org.hypercerts.claim.activity"

local function query(sql, values)
  if db.backend() ~= "postgres" then error("ActivityQueryFailed: activity API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ActivityQueryFailed: activity lookup failed", 0)
  end
  return result
end

local function activity_view(row)
  return activity_projection_view(row)
end

local function hydrate_activity_views(views)
  return activity_projection_hydrate_views(views)
end

local function valid_datetime(value)
  if type(value) ~= "string" then return false end
  local year, month, day, hour, minute, second, suffix = value:match(
    "^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)(.*)$")
  if not year then return false end
  year, month, day = tonumber(year), tonumber(month), tonumber(day)
  if year < 1 then return false end
  hour, minute, second = tonumber(hour), tonumber(minute), tonumber(second)
  if month < 1 or month > 12 or hour > 23 or minute > 59 or second > 59 then return false end
  local leap = year % 4 == 0 and (year % 100 ~= 0 or year % 400 == 0)
  local month_days = { 31, leap and 29 or 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 }
  if day < 1 or day > month_days[month] then return false end
  local fraction, zone = suffix:match("^(%.%d+)(Z)$")
  if not fraction then fraction, zone = suffix:match("^(%.%d+)([+-]%d%d:%d%d)$") end
  if not fraction then zone = suffix:match("^(Z)$") end
  if not zone then zone = suffix:match("^([+-]%d%d:%d%d)$") end
  if not zone or zone == "-00:00" then return false end
  if zone ~= "Z" then
    local zh, zm = zone:match("^[+-](%d%d):(%d%d)$")
    if not zh or tonumber(zh) > 23 or tonumber(zm) > 59 then return false end
  end
  return true
end

local function parse_list_limit(params)
  local limit_value = scalar(params, "limit")
  if limit_value and not limit_value:match("^%d+$") then invalid("limit must be an integer from 1 through 100") end
  local limit = limit_value and tonumber(limit_value) or 25
  if not limit or limit % 1 ~= 0 or limit < 1 or limit > 100 then invalid("limit must be an integer from 1 through 100") end
  return limit
end

local CREATED_AT_SORT_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"

-- Sort key for a happyview_records row: the record's own createdAt when it is a
-- valid timestamp, otherwise COALESCE(indexed_at, created_at). `alias` is the
-- table alias; nil selects unqualified columns.
local function created_at_sort(alias)
  local prefix = alias and (alias .. ".") or ""
  local record, indexed_at, created_at = prefix .. "record", prefix .. "indexed_at", prefix .. "created_at"
  local created = record .. "::jsonb->>'createdAt'"
  return "CASE WHEN jsonb_typeof(" .. record .. "::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. CREATED_AT_SORT_PATTERN .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE COALESCE(" .. indexed_at ..
    "::timestamptz, " .. created_at .. "::timestamptz) END"
end

-- The hex prologue every list cursor shape shares: rejects empty, over-long (8192),
-- odd-length and non-lowercase-hex tokens with "cursor is malformed" and returns the
-- decoded JSON text. Shape and JSON checks stay with each cursor's own decoder.
local function decode_hex_cursor_token(token)
  if #token == 0 or #token > 8192 or #token % 2 ~= 0 or token:find("[^0-9a-f]") then
    invalid("cursor is malformed")
  end
  return (token:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end))
end

-- Hex-encodes the JSON of a cursor table.
local function cursor_encode(value)
  local encoded = json.encode(value)
  return (encoded:gsub(".", function(char) return string.format("%02x", string.byte(char)) end))
end

-- luacheck: push ignore 211
-- Decodes a hex-encoded {v, d, t, u} list cursor. Rejects malformed tokens, other
-- sort directions and unknown keys; validate_value(value) -> boolean runs the
-- endpoint-specific check on t and u. Not for endpoints that skip the 8192-character
-- cap or accept extra keys.
local function decode_cursor(token, direction, validate_value)
  if token == nil then return nil end
  local decoded = decode_hex_cursor_token(token)
  local ok, value = pcall(json.decode, decoded)
  if not ok or type(value) ~= "table" or value.v ~= 1 or value.d ~= direction
    or type(value.t) ~= "string" or type(value.u) ~= "string" then
    invalid("cursor is malformed or belongs to another sortDirection")
  end
  for key in pairs(value) do
    if key ~= "v" and key ~= "d" and key ~= "t" and key ~= "u" then invalid("cursor is malformed") end
  end
  if not validate_value(value) then invalid("cursor is malformed") end
  return value
end

-- decode_cursor for the common case: t is a datetime and u a record URI.
-- record_uri is the collection NSID u must belong to, or a predicate(uri) -> boolean
-- for endpoints with stricter URI rules. valid_t(t) defaults to valid_datetime.
local function decode_record_cursor(token, direction, record_uri, valid_t)
  valid_t = valid_t or valid_datetime
  return decode_cursor(token, direction, function(value)
    if not valid_t(value.t) then return false end
    if type(record_uri) == "function" then return record_uri(value.u) end
    local valid, collection = valid_record_uri(value.u)
    return valid and collection == record_uri
  end)
end
-- luacheck: pop

local function parse_sort_direction(params)
  local direction = scalar(params, "sortDirection") or "desc"
  if direction ~= "asc" and direction ~= "desc" then invalid("sortDirection must be 'asc' or 'desc'") end
  return direction
end

-- Appends each item to binds and returns its "$n" placeholders, in order.
local function bind_values(binds, items)
  local placeholders = {}
  for _, item in ipairs(items) do
    binds[#binds + 1] = item
    placeholders[#placeholders + 1] = "$" .. #binds
  end
  return placeholders
end

-- Adds `column IN ($n, ...)` to where, binding items; an empty list matches nothing.
local function add_in(where, binds, column, items)
  if #items == 0 then
    where[#where + 1] = "FALSE"
    return
  end
  where[#where + 1] = column .. " IN (" .. table.concat(bind_values(binds, items), ", ") .. ")"
end

local function parse_include_total(values)
  local value = values.includeTotal
  if value == nil then return false end
  if type(value) == "boolean" then return value end
  value = scalar(values, "includeTotal")
  if value == "true" then return true end
  if value == "false" then return false end
  invalid("includeTotal must be true or false")
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

local function activity_query(authors, has_organization_record, contributors, involved_actors, uris, search, limit, cursor, direction, include_total)
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
  local filter_sql = table.concat(where, " AND ")
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
  local page_sql = "SELECT " .. (include_total and "sorted.sort_at AS sort_at, " or "") ..
    "activity.uri, activity.did, activity.cid, activity.indexed_at::text AS indexed_at, " ..
    "activity.record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', " ..
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS activity CROSS JOIN LATERAL (SELECT " .. created_at_sort("activity") .. " AS sort_at) AS sorted " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", activity.uri " .. ordering .. " LIMIT $" .. #values
  local sql = page_sql
  if include_total then
    sql = "WITH total AS (SELECT COUNT(*) AS total_count FROM happyview_records AS activity WHERE " .. filter_sql .. "), " ..
      "page AS (" .. page_sql .. ") " ..
      "SELECT page.uri, page.did, page.cid, page.indexed_at, page.record, page.sort_timestamp, total.total_count " ..
      "FROM total LEFT JOIN page ON TRUE ORDER BY page.sort_at " .. ordering .. ", page.uri " .. ordering
  end

  local rows = query(sql, values)
  local total_count
  if include_total then
    total_count = rows[1] and tonumber(rows[1].total_count)
    if not total_count or total_count < 0 or total_count > 9007199254740991 or total_count % 1 ~= 0 then
      error("ActivityQueryFailed: activity count unavailable", 0)
    end
    if rows[1].uri == nil then rows = {} end
  end
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
  return views, next_cursor, total_count
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
  if search_enabled then allowed.search = true else allowed.includeTotal = true end
  keys_only(params, allowed, "unknown query parameter: ")

  local authors = activity_array("authors", "did")
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
  local include_total = false
  if not search_enabled then include_total = parse_include_total(params) end
  local direction = parse_sort_direction(params)
  local limit = parse_list_limit(params)
  local cursor = decode_record_cursor(scalar(params, "cursor"), direction, ACTIVITY)
  local activities, next_cursor, total_count = activity_query(
    authors, has_organization_record, contributors, involved_actors, uris, search, limit, cursor, direction, include_total)
  local response = { activities = toarray(activities) }
  if next_cursor then response.cursor = next_cursor end
  if include_total then response.totalCount = total_count end
  return response
end

function handle()
  return activity_list_response(true)
end
