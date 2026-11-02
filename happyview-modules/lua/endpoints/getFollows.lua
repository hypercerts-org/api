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

local FOLLOW = "app.certified.graph.follow"

-- Guard the cast inside CASE; a WHERE filter cannot protect it from planner reordering.
local function follow_sort_key()
  local created = "record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(record::jsonb->'createdAt') = 'string' AND " .. created .. " ~ '" .. zoned .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created .. ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE COALESCE(indexed_at::timestamptz, created_at::timestamptz) END"
end

local function query(sql, values)
  if db.backend() ~= "postgres" then error("ActorFollowQueryFailed: actor-follow queries require PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("ActorFollowQueryFailed: actor-follow lookup failed", 0) end
  return result
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

local function get_follows()
  keys_only(params, { actor = true, subjects = true })
  local actor = scalar(params, "actor")
  if not actor or not valid_did(actor) then invalid("actor must be a valid DID") end
  local subjects, unique_subjects = follow_batch_targets(
    actor, "subjects", params.subjects, valid_did, "valid DIDs", "app.certified.graph.getFollows")

  local values, requested = { FOLLOW, actor }, {}
  for _, subject in ipairs(unique_subjects) do
    values[#values + 1] = subject
    requested[#requested + 1] = "($" .. #values .. "::text)"
  end

  local rows = query(
    "WITH requested(target) AS (VALUES " .. table.concat(requested, ", ") .. ") "
      .. "SELECT DISTINCT ON (requested.target) requested.target AS target, uri, did, cid, "
      .. "indexed_at::text AS indexed_at, record::text AS record FROM requested "
      .. "JOIN happyview_records ON collection = $1 AND did = $2 AND record::jsonb->>'subject' = requested.target "
      .. "CROSS JOIN LATERAL (SELECT " .. follow_sort_key() .. " AS sort_at) sorted "
      .. "ORDER BY requested.target, sorted.sort_at ASC, uri ASC",
    values)
  if type(rows) ~= "table" then error("ActorFollowQueryFailed: actor-follow lookup failed", 0) end

  local follows_by_subject = {}
  for _, row in ipairs(rows) do follows_by_subject[row.target] = record_view(row) end

  local results = {}
  for _, subject in ipairs(subjects) do
    results[#results + 1] = { subject = subject, follow = follows_by_subject[subject] or NULL }
  end
  return { results = toarray(results) }
end

function handle()
  return get_follows()
end
