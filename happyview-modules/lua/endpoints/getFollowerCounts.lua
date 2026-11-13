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

-- An atproto NSID: at least three dot-separated segments, at most 317 characters.
local function valid_nsid(value)
  if type(value) ~= "string" or #value > 317 then return false end
  local segments = {}
  for segment in value:gmatch("[^%.]+") do segments[#segments + 1] = segment end
  if #segments < 3 or table.concat(segments, ".") ~= value then return false end
  for index = 1, #segments - 1 do
    local segment = segments[index]
    if #segment > 63 or segment:find("[^A-Za-z0-9%-]") then return false end
    local first, last = segment:sub(1, 1), segment:sub(-1)
    if not first:match(index == 1 and "^[A-Za-z]$" or "^[A-Za-z0-9]$")
      or not last:match("^[A-Za-z0-9]$") then return false end
  end
  local name = segments[#segments]
  return #name <= 63 and name:match("^[A-Za-z][A-Za-z0-9]*$") ~= nil
end

-- valid_did allows "%" in a DID; the DID syntax requires two hex digits after it.
local function valid_did_percent_escapes(authority)
  local index = 1
  while index <= #authority do
    if authority:sub(index, index) == "%" then
      if not authority:sub(index + 1, index + 2):match("^%x%x$") then return false end
      index = index + 3
    else
      index = index + 1
    end
  end
  return true
end

-- A record subject: a full DID-authority AT-URI with a valid collection NSID.
local function valid_subject_record_uri(value)
  if #value > 8192 then return false end
  local valid, collection, authority = valid_record_uri(value)
  return valid and valid_did_percent_escapes(authority) and valid_nsid(collection)
end

-- 16 KiB fits 100 typical hypercert AT-URIs (~10.5 KB encoded) and stays within
-- Node's default 16 KiB header limit for downstream callers. The pinned
-- HappyView release turns every Lua error() into HTTP 500 script_error, so an
-- overflow cannot be a 400 yet; the InvalidRequest: prefix names the cause.
local BATCH_MAX_REQUEST_TARGET_BYTES = 16384

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

-- Rejects batches whose percent-encoded GET request-target would exceed the
-- shared byte limit. actor is nil for batch queries that take only the target
-- list; the first target's "&" then stands in for the "?".
local function assert_batch_request_target(endpoint, actor, key, targets)
  local request_target_length = #("/xrpc/" .. endpoint)
  if actor then
    request_target_length = request_target_length + #("?actor=") + encoded_query_value_length(actor)
  end
  for _, target in ipairs(targets) do
    request_target_length = request_target_length + #("&" .. key .. "=") + encoded_query_value_length(target)
  end
  if request_target_length > BATCH_MAX_REQUEST_TARGET_BYTES then
    invalid(key .. " makes the encoded GET request-target exceed " .. BATCH_MAX_REQUEST_TARGET_BYTES .. " bytes")
  end
end

local FOLLOW_BATCH_MAX_TARGETS = 100

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

  local unique, seen = {}, {}
  for _, target in ipairs(targets) do
    if type(target) ~= "string" or not validate(target) then
      invalid("each " .. key .. " value must be " .. description)
    end
    if not seen[target] then
      seen[target] = true
      unique[#unique + 1] = target
    end
  end

  assert_batch_request_target(endpoint, actor, key, targets)
  return targets, unique
end

local FOLLOW = "app.certified.graph.follow"
local ENTITY_FOLLOW = "app.certified.graph.entityFollow"

-- DIDs are account follows; anything else must be an entity-follow AT-URI.
local function valid_follower_count_subject(value)
  if value:sub(1, 4) == "did:" then return valid_did(value) end
  return valid_subject_record_uri(value)
end

local function follower_count_placeholders(values, subjects)
  local placeholders = {}
  for _, subject in ipairs(subjects) do
    values[#values + 1] = subject
    placeholders[#placeholders + 1] = "$" .. #values
  end
  return table.concat(placeholders, ", ")
end

-- One statement for both collections. Each branch counts distinct publishers per
-- subject, which equals the deduplicated relationship totalCount of
-- listActorFollowers and listEntityFollowers.
local function follower_count_query(dids, entity_uris)
  local backend_ok, backend = pcall(db.backend)
  if not backend_ok or backend ~= "postgres" then
    error("FollowerCountQueryFailed: follower counts require PostgreSQL", 0)
  end

  local values, branches = {}, {}
  if #dids > 0 then
    values[#values + 1] = FOLLOW
    local collection = "$" .. #values
    local subject = "record::jsonb->>'subject'"
    branches[#branches + 1] = "SELECT " .. subject .. " AS subject, COUNT(DISTINCT did) AS follower_count " ..
      "FROM happyview_records WHERE collection = " .. collection .. " AND " .. subject ..
      " IN (" .. follower_count_placeholders(values, dids) .. ") GROUP BY " .. subject
  end
  if #entity_uris > 0 then
    values[#values + 1] = ENTITY_FOLLOW
    local collection = "$" .. #values
    local subject = "record::jsonb->'subject'->>'uri'"
    branches[#branches + 1] = "SELECT " .. subject .. " AS subject, COUNT(DISTINCT did) AS follower_count " ..
      "FROM happyview_records WHERE collection = " .. collection .. " AND " .. subject ..
      " IN (" .. follower_count_placeholders(values, entity_uris) .. ") GROUP BY " .. subject
  end

  local ok, rows = pcall(db.raw, table.concat(branches, " UNION ALL "), values)
  if not ok or type(rows) ~= "table" then
    error("FollowerCountQueryFailed: indexed follower count query failed", 0)
  end
  return rows
end

local function follower_count_number(value)
  local count = tonumber(value)
  if not count or count < 0 or count % 1 ~= 0 then
    error("FollowerCountQueryFailed: indexed follower count was unavailable", 0)
  end
  return count
end

local function get_follower_counts()
  keys_only(params, { subjects = true })
  -- A single subject arrives as a plain value; read it like getReactionCounts does.
  local subjects_param = params.subjects
  if type(subjects_param) == "string" then subjects_param = scalar(params, "subjects") end
  local subjects, unique_subjects = follow_batch_targets(
    nil, "subjects", subjects_param, valid_follower_count_subject,
    "a valid DID or a full AT-URI with a DID authority and valid collection NSID",
    "app.certified.graph.getFollowerCounts")

  local dids, entity_uris = {}, {}
  for _, subject in ipairs(unique_subjects) do
    if subject:sub(1, 4) == "did:" then
      dids[#dids + 1] = subject
    else
      entity_uris[#entity_uris + 1] = subject
    end
  end

  local counts_by_subject = {}
  for _, row in ipairs(follower_count_query(dids, entity_uris)) do
    if type(row) ~= "table" or type(row.subject) ~= "string" then
      error("FollowerCountQueryFailed: indexed follower count subject was unavailable", 0)
    end
    counts_by_subject[row.subject] = follower_count_number(row.follower_count)
  end

  local counts = {}
  for _, subject in ipairs(subjects) do
    counts[#counts + 1] = { subject = subject, followerCount = counts_by_subject[subject] or 0 }
  end
  return { counts = toarray(counts) }
end

function handle()
  return get_follower_counts()
end
