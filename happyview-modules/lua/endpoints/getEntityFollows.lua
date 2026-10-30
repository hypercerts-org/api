local function valid_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
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

local ENTITY_FOLLOW = "app.certified.graph.entityFollow"
local ENTITY_FOLLOW_NULL = json.decode("null")

local function entity_follow_query(sql, values)
  if db.backend() ~= "postgres" then
    error("EntityFollowQueryFailed: entity-follow queries require PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("EntityFollowQueryFailed: entity-follow lookup failed", 0)
  end
  return result
end

-- Keep malformed publisher timestamps out of casts; preserve the actor-follow fallback order.
local function entity_follow_sort_key()
  local created = "record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(record::jsonb->'createdAt') = 'string' AND " .. created .. " ~ '" .. zoned .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created .. ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE COALESCE(indexed_at::timestamptz, created_at::timestamptz) END"
end

local function entity_follow_indexed_record_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and ENTITY_FOLLOW_NULL or row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end

local function entity_follow_record_view(row)
  local view = entity_follow_indexed_record_view(row)
  view["$type"] = "app.certified.graph.getEntityFollow#entityFollowRecordView"
  return view
end

local FOLLOW_BATCH_MAX_TARGETS = 100
local FOLLOW_BATCH_MAX_REQUEST_TARGET_BYTES = 7000

local function encoded_query_value_length(value)
  local length = 0
  for index = 1, #value do
    local byte = value:byte(index)
    if (byte >= 48 and byte <= 57) or (byte >= 65 and byte <= 90) or (byte >= 97 and byte <= 122)
      or byte == 42 or byte == 45 or byte == 46 or byte == 95 then
      length = length + 1
    else
      length = length + 3
    end
  end
  return length
end

local function follow_batch_targets(actor, key, value, validate, description, endpoint)
  if value == nil then invalid(key .. " is required") end

  local targets = {}
  if type(value) == "string" then
    targets[1] = value
  elseif type(value) == "table" then
    local count, max_index = 0, 0
    for index in pairs(value) do
      if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
        invalid(key .. " must be a repeated string parameter")
      end
      count = count + 1
      if index > max_index then max_index = index end
    end
    if count ~= max_index then invalid(key .. " must be a contiguous array") end
    if count < 1 or count > FOLLOW_BATCH_MAX_TARGETS then
      invalid(key .. " must contain 1 through " .. FOLLOW_BATCH_MAX_TARGETS .. " values")
    end
    for index = 1, max_index do
      targets[index] = value[index]
    end
  else
    invalid(key .. " must be a repeated string parameter")
  end

  if #targets < 1 or #targets > FOLLOW_BATCH_MAX_TARGETS then
    invalid(key .. " must contain 1 through " .. FOLLOW_BATCH_MAX_TARGETS .. " values")
  end

  local request_target_length = #("/xrpc/" .. endpoint .. "?actor=") + encoded_query_value_length(actor)
  local unique, seen = {}, {}
  for _, target in ipairs(targets) do
    if type(target) ~= "string" or not validate(target) then
      invalid("each " .. key .. " value must be " .. description)
    end
    request_target_length = request_target_length + #("&" .. key .. "=") + encoded_query_value_length(target)
    if not seen[target] then
      seen[target] = true
      unique[#unique + 1] = target
    end
  end

  if request_target_length > FOLLOW_BATCH_MAX_REQUEST_TARGET_BYTES then
    invalid(key .. " makes the encoded GET request-target exceed " .. FOLLOW_BATCH_MAX_REQUEST_TARGET_BYTES .. " bytes")
  end
  return targets, unique
end

local function get_entity_follows()
  keys_only(params, { actor = true, entities = true })
  local actor = scalar(params, "actor")
  if not actor or not valid_did(actor) then invalid("actor must be a valid DID") end
  local function valid_nsid(value)
    if type(value) ~= "string" or #value > 317 then return false end
    local segments = {}
    for segment in value:gmatch("[^%.]+") do segments[#segments + 1] = segment end
    if #segments < 3 or table.concat(segments, ".") ~= value then return false end

    for _, segment in ipairs(segments) do
      if #segment > 63 or segment:find("[^A-Za-z0-9%-]")
        or segment:sub(1, 1) == "-" or segment:sub(-1) == "-" then
        return false
      end
    end

    if not segments[1]:sub(1, 1):match("^[A-Za-z]$") then return false end
    return segments[#segments]:match("^[A-Za-z][A-Za-z0-9]*$") ~= nil
  end

  local function valid_entity_uri(value)
    if #value > 8192 then return false end
    local valid, collection = valid_record_uri(value)
    return valid and valid_nsid(collection)
  end
  local entities, unique_entities = follow_batch_targets(
    actor, "entities", params.entities, valid_entity_uri,
    "full AT-URI with a DID authority and valid collection NSID", "app.certified.graph.getEntityFollows")

  local values, requested = { ENTITY_FOLLOW, actor }, {}
  for _, entity_uri in ipairs(unique_entities) do
    values[#values + 1] = entity_uri
    requested[#requested + 1] = "($" .. #values .. "::text)"
  end

  local rows = entity_follow_query(
    "WITH requested(target) AS (VALUES " .. table.concat(requested, ", ") .. ") "
      .. "SELECT DISTINCT ON (requested.target) requested.target AS target, uri, did, cid, "
      .. "indexed_at::text AS indexed_at, record::text AS record FROM requested "
      .. "JOIN happyview_records ON collection = $1 AND did = $2 "
      .. "AND record::jsonb->'subject'->>'uri' = requested.target "
      .. "CROSS JOIN LATERAL (SELECT " .. entity_follow_sort_key() .. " AS sort_at) sorted "
      .. "ORDER BY requested.target, sorted.sort_at ASC, uri ASC",
    values)

  local follows_by_entity = {}
  for _, row in ipairs(rows) do follows_by_entity[row.target] = entity_follow_record_view(row) end

  local results = {}
  for _, entity_uri in ipairs(entities) do
    results[#results + 1] = { entity = entity_uri, follow = follows_by_entity[entity_uri] or ENTITY_FOLLOW_NULL }
  end
  return { results = toarray(results) }
end

function handle()
  return get_entity_follows()
end
