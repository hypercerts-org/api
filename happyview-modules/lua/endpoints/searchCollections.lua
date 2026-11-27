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

local NULL = json.decode("null")

local function record_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and NULL or row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end

-- luacheck: push ignore 211
-- Like record_view, but a row without indexed_at has no indexedAt key instead of JSON null.
-- Pass it to hydrate_actor_views for sidecars that preserve the omission.
local function record_view_omitting_indexed_at(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end
-- luacheck: pop

local COLLECTION_PROJECTION_PROFILE = "app.certified.actor.profile"
local COLLECTION_PROJECTION_ORGANIZATION = "app.certified.actor.organization"
local COLLECTION_PROJECTION_LOCATION = "app.certified.location"
local COLLECTION_PROJECTION_TAG = "org.hypercerts.vocab.tag"
local COLLECTION_PROJECTION_NULL = json.decode("null")

local function collection_projection_query(sql, values)
  if db.backend() ~= "postgres" then
    error("CollectionQueryFailed: collection API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("CollectionQueryFailed: collection lookup failed", 0)
  end
  return result
end

local function collection_projection_ref_key(uri, cid)
  return uri .. "\0" .. cid
end

local function collection_projection_add_unique(values, seen, value)
  if not seen[value] then
    seen[value] = true
    values[#values + 1] = value
  end
end

local function collection_projection_load_actor_records(collection, dids)
  if #dids == 0 then return {} end
  local values, placeholders = { collection }, {}
  for _, did in ipairs(dids) do
    values[#values + 1] = did
    placeholders[#placeholders + 1] = "$" .. #values
  end
  local rows = collection_projection_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(placeholders, ", ") .. ")",
    values)
  local by_did = {}
  for _, row in ipairs(rows) do by_did[row.did] = row end
  return by_did
end

local function collection_projection_load_exact_refs(collection, references)
  local rows_by_version = {}
  for first = 1, #references, 300 do
    local values, predicates = { collection }, {}
    local last = math.min(first + 299, #references)
    for index = first, last do
      local reference = references[index]
      values[#values + 1] = reference.uri
      local uri_parameter = "$" .. #values
      values[#values + 1] = reference.cid
      local cid_parameter = "$" .. #values
      predicates[#predicates + 1] = "(uri = " .. uri_parameter .. " AND cid = " .. cid_parameter .. ")"
    end
    local rows = collection_projection_query(
      "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
        "FROM happyview_records WHERE collection = $1 AND (" .. table.concat(predicates, " OR ") .. ")",
      values)
    for _, row in ipairs(rows) do
      rows_by_version[collection_projection_ref_key(row.uri, row.cid)] = row
    end
  end
  return rows_by_version
end

local function collection_projection_reference(value, field, expected_collection, omit_invalid)
  if type(value) ~= "table" or type(value.uri) ~= "string" or type(value.cid) ~= "string" then
    if omit_invalid then return nil end
    error("CollectionQueryFailed: indexed collection has an invalid " .. field .. " reference", 0)
  end
  local valid, collection = valid_bounded_record_uri(value.uri)
  if not valid then
    if omit_invalid then return nil end
    error("CollectionQueryFailed: indexed collection has an invalid " .. field .. " reference", 0)
  end
  return {
    uri = value.uri,
    cid = value.cid,
    matches_collection = not expected_collection or collection == expected_collection,
  }
end

local function collection_projection_view(row)
  local record = json.decode(row.record)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and COLLECTION_PROJECTION_NULL or row.indexed_at,
    did = row.did,
    author = { did = row.did },
    record = record,
  }
end

local function collection_projection_hydrate(views, omit_invalid)
  if #views == 0 then return end

  local author_dids, seen_authors = {}, {}
  local location_refs, seen_locations = {}, {}
  local tag_refs, seen_tags = {}, {}
  for _, view in ipairs(views) do
    collection_projection_add_unique(author_dids, seen_authors, view.did)
    if view.record.location ~= nil then
      local reference = collection_projection_reference(view.record.location, "location", COLLECTION_PROJECTION_LOCATION, omit_invalid)
      if reference and reference.matches_collection then
        local key = collection_projection_ref_key(reference.uri, reference.cid)
        if not seen_locations[key] then
          seen_locations[key] = true
          location_refs[#location_refs + 1] = reference
        end
      end
    end
    if view.record.tags ~= nil then
      if type(view.record.tags) ~= "table" then
        error("CollectionQueryFailed: indexed collection tags are not an array", 0)
      end
      for _, source in ipairs(view.record.tags) do
        local reference = collection_projection_reference(source, "tag", COLLECTION_PROJECTION_TAG, omit_invalid)
        if reference and reference.matches_collection then
          local key = collection_projection_ref_key(reference.uri, reference.cid)
          if not seen_tags[key] then
            seen_tags[key] = true
            reference.key = key
            tag_refs[#tag_refs + 1] = reference
          end
        end
      end
    end
  end

  local profiles = collection_projection_load_actor_records(COLLECTION_PROJECTION_PROFILE, author_dids)
  local organizations = collection_projection_load_actor_records(COLLECTION_PROJECTION_ORGANIZATION, author_dids)
  local locations = collection_projection_load_exact_refs(COLLECTION_PROJECTION_LOCATION, location_refs)
  local tags = collection_projection_load_exact_refs(COLLECTION_PROJECTION_TAG, tag_refs)

  for _, view in ipairs(views) do
    view.author.profile = profiles[view.did] and record_view(profiles[view.did]) or COLLECTION_PROJECTION_NULL
    view.author.organization = organizations[view.did] and record_view(organizations[view.did]) or COLLECTION_PROJECTION_NULL

    local source_location = view.record.location ~= nil and
      collection_projection_reference(view.record.location, "location", COLLECTION_PROJECTION_LOCATION, omit_invalid) or nil
    if source_location ~= nil then
      local key = collection_projection_ref_key(source_location.uri, source_location.cid)
      local row = locations[key]
      view.location = {
        uri = source_location.uri,
        cid = source_location.cid,
        record = row and record_view(row) or COLLECTION_PROJECTION_NULL,
      }
    end

    local source_tags = view.record.tags
    if source_tags ~= nil then
      local projected_tags = {}
      for _, source in ipairs(source_tags) do
        local reference = collection_projection_reference(source, "tag", COLLECTION_PROJECTION_TAG, omit_invalid)
        if reference then
          local row = tags[collection_projection_ref_key(reference.uri, reference.cid)]
          projected_tags[#projected_tags + 1] = {
            uri = reference.uri,
            cid = reference.cid,
            record = row and record_view(row) or COLLECTION_PROJECTION_NULL,
          }
        end
      end
      view.tags = toarray(projected_tags)
    end
  end
end

local COLLECTION = "org.hypercerts.collection"

local function collection_query(sql, values)
  if db.backend() ~= "postgres" then
    error("CollectionQueryFailed: collection API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("CollectionQueryFailed: collection lookup failed", 0)
  end
  return result
end

local function collection_view(row)
  return collection_projection_view(row)
end

local function collection_hydrate(views, omit_invalid)
  return collection_projection_hydrate(views, omit_invalid)
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

-- Reads a repeated query parameter (?key=a&key=b) as a list of strings, or nil when absent.
-- A single value counts as a list of one. Rejects non-string entries, keyed or sparse
-- tables and more than 100 values. Item rules stay with the caller so each endpoint keeps
-- its own error messages; see unique_query_values.
local function query_string_values(params, key)
  local value = params[key]
  if value == nil then return nil end
  if type(value) == "string" then return { value } end
  if type(value) ~= "table" then
    invalid(key .. " must be a string or repeated string parameter")
  end
  local count = 0
  for index in pairs(value) do
    if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
      invalid(key .. " must use repeated query values")
    end
    count = count + 1
  end
  if count ~= #value then invalid(key .. " must use repeated query values") end
  local values = {}
  for index = 1, count do
    if type(value[index]) ~= "string" then invalid(key .. " entries must be strings") end
    values[index] = value[index]
  end
  if #values > 100 then invalid(key .. " accepts at most 100 values") end
  return values
end

-- Runs check(item, index) on every value in order, then returns the distinct results in
-- first-seen order. check raises its own error for a bad item and may return a normalized
-- replacement; returning nothing keeps the item.
local function unique_query_values(values, check)
  local unique, seen = {}, {}
  for index, item in ipairs(values) do
    local value = check and check(item, index) or item
    if not seen[value] then
      seen[value] = true
      unique[#unique + 1] = value
    end
  end
  return unique
end

local function parse_list_limit(params)
  local limit_value = scalar(params, "limit")
  if limit_value and not limit_value:match("^%d+$") then invalid("limit must be an integer from 1 through 100") end
  local limit = limit_value and tonumber(limit_value) or 25
  if not limit or limit % 1 ~= 0 or limit < 1 or limit > 100 then invalid("limit must be an integer from 1 through 100") end
  return limit
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

function handle()
  return collection_list_response(true)
end
