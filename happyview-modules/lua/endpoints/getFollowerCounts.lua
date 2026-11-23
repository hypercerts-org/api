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

-- Some clients wrote account follows whose `via` points at the followed
-- account's own org.hypercerts.collection, using the account follow as a
-- project follow. Those records stay indexed but are not account follows, so
-- every account-follow query applies this predicate in its WHERE clause, before
-- any per-relationship deduplication, so a user's genuine follow of the same
-- account is still found.
--
-- The rule is deliberately narrow: only a collection owned by the subject
-- matches. A starter pack, list, or collection owned by another DID is a real
-- mediating record and is kept. COALESCE keeps records with no usable `via`.
-- The expression only reads the row's own `record`, so it adds a per-row filter
-- on rows already selected by collection, subject, or publisher.
local function account_follow_filter_sql()
  return "NOT COALESCE(starts_with(record::jsonb->'via'->>'uri', 'at://' || (record::jsonb->>'subject') || '/org.hypercerts.collection/'), FALSE)"
end

-- 16 KiB fits 100 typical hypercert AT-URIs (~10.5 KB encoded). The cap covers
-- only the request-target; Node clients and proxies count the whole header block
-- against --max-http-header-size (default 16 KiB), so callers sending near-limit
-- batches may need to raise it. The pinned
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

-- Count queries for getReactionCounts, getCommentCounts and getFollowerCounts.
--
-- Each query starts from happyview_record_refs, which HappyView fills with every
-- `at://` string found anywhere in a record and indexes by (target_uri, collection),
-- then joins the source record. The refs row only says "this record mentions this
-- URI somewhere", so every query re-checks the field that defines the relationship.
-- Without the re-check a like whose `via` points at a repost would count as a like
-- of that repost.
--
-- These counts are only as complete as happyview_record_refs. A record whose refs
-- were never written is not counted.

-- One table keeps endpoints that use only some of these queries free of unused-local warnings.
local ref_counts = {}

local REF_COUNT_LIKE = "app.certified.feed.like"
local REF_COUNT_REPOST = "app.certified.feed.repost"
local REF_COUNT_COMMENT_ATTACHMENT = "org.hypercerts.context.attachment"
local REF_COUNT_COMMENT_CONTENT_TYPE = "comment"
local REF_COUNT_ENTITY_FOLLOW = "app.certified.graph.entityFollow"

-- Appends each subject to `values` and returns the placeholder list for an IN clause.
function ref_counts.in_list(values, subjects)
  local placeholders = {}
  for _, subject in ipairs(subjects) do
    values[#values + 1] = subject
    placeholders[#placeholders + 1] = "$" .. #values
  end
  return table.concat(placeholders, ", ")
end

local function ref_count_bind(values, value)
  values[#values + 1] = value
  return "$" .. #values
end

-- Rows: subject_uri, like_count, repost_count. Distinct publisher DIDs per subject.
function ref_counts.reaction_sql(values, subjects)
  local like = ref_count_bind(values, REF_COUNT_LIKE)
  local repost = ref_count_bind(values, REF_COUNT_REPOST)
  return "SELECT ref.target_uri AS subject_uri, " ..
    "COUNT(DISTINCT source.did) FILTER (WHERE source.collection = " .. like .. ") AS like_count, " ..
    "COUNT(DISTINCT source.did) FILTER (WHERE source.collection = " .. repost .. ") AS repost_count " ..
    "FROM happyview_record_refs AS ref JOIN happyview_records AS source ON source.uri = ref.source_uri " ..
    "WHERE ref.target_uri IN (" .. ref_counts.in_list(values, subjects) .. ") " ..
    "AND ref.collection IN (" .. like .. ", " .. repost .. ") " ..
    "AND source.record::jsonb->'subject'->>'uri' = ref.target_uri " ..
    "GROUP BY ref.target_uri"
end

-- Rows: subject, comment_count. Every direct comment counts, not distinct authors.
-- COUNT(DISTINCT uri) keeps a comment that lists the same subject twice from counting
-- twice. A non-array subjects value expands to no rows, matching listAttachments.
function ref_counts.comment_sql(values, subjects)
  local collection = ref_count_bind(values, REF_COUNT_COMMENT_ATTACHMENT)
  local content_type = ref_count_bind(values, REF_COUNT_COMMENT_CONTENT_TYPE)
  return "SELECT ref.target_uri AS subject, COUNT(DISTINCT source.uri) AS comment_count " ..
    "FROM happyview_record_refs AS ref JOIN happyview_records AS source ON source.uri = ref.source_uri " ..
    "WHERE ref.collection = " .. collection .. " AND source.record::jsonb->>'contentType' = " .. content_type .. " " ..
    "AND ref.target_uri IN (" .. ref_counts.in_list(values, subjects) .. ") " ..
    "AND EXISTS (SELECT 1 FROM jsonb_array_elements(" ..
    "CASE WHEN jsonb_typeof(source.record::jsonb->'subjects') = 'array' " ..
    "THEN source.record::jsonb->'subjects' ELSE '[]'::jsonb END) AS subject(value) " ..
    "WHERE subject.value->>'uri' = ref.target_uri) " ..
    "GROUP BY ref.target_uri"
end

-- Rows: subject, follower_count. Distinct publisher DIDs per entity URI. Account
-- follows store a bare DID, which is not an `at://` string and has no refs row, so
-- callers keep scanning app.certified.graph.follow for DID subjects.
function ref_counts.entity_follower_sql(values, entity_uris)
  local collection = ref_count_bind(values, REF_COUNT_ENTITY_FOLLOW)
  return "SELECT ref.target_uri AS subject, COUNT(DISTINCT source.did) AS follower_count " ..
    "FROM happyview_record_refs AS ref JOIN happyview_records AS source ON source.uri = ref.source_uri " ..
    "WHERE ref.collection = " .. collection .. " " ..
    "AND ref.target_uri IN (" .. ref_counts.in_list(values, entity_uris) .. ") " ..
    "AND source.record::jsonb->'subject'->>'uri' = ref.target_uri " ..
    "GROUP BY ref.target_uri"
end

-- `failures.backend` and `failures.query` are the complete error messages, so each
-- endpoint keeps its own named error. Failures never turn into zero counts.
function ref_counts.run(failures, sql, values)
  local backend_ok, backend = pcall(db.backend)
  if not backend_ok or backend ~= "postgres" then error(failures.backend, 0) end
  local ok, rows = pcall(db.raw, sql, values)
  if not ok or type(rows) ~= "table" then error(failures.query, 0) end
  return rows
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

-- DIDs are account follows; anything else must be an entity-follow AT-URI.
local function valid_follower_count_subject(value)
  if value:sub(1, 4) == "did:" then return valid_did(value) end
  return valid_subject_record_uri(value)
end

-- One statement for both kinds. Each branch counts distinct publishers per subject,
-- which equals the deduplicated relationship totalCount of listActorFollowers and
-- listEntityFollowers. Account follows store a bare DID, which happyview_record_refs
-- does not hold, so DIDs scan the follow collection; entity URIs use the refs index.
local function follower_count_query(dids, entity_uris)
  local values, branches = {}, {}
  if #dids > 0 then
    values[#values + 1] = FOLLOW
    local collection = "$" .. #values
    local subject = "record::jsonb->>'subject'"
    branches[#branches + 1] = "SELECT " .. subject .. " AS subject, COUNT(DISTINCT did) AS follower_count " ..
      "FROM happyview_records WHERE collection = " .. collection .. " AND " .. subject ..
      " IN (" .. ref_counts.in_list(values, dids) .. ") AND " .. account_follow_filter_sql() .. " GROUP BY " .. subject
  end
  if #entity_uris > 0 then
    branches[#branches + 1] = ref_counts.entity_follower_sql(values, entity_uris)
  end

  return ref_counts.run({
    backend = "FollowerCountQueryFailed: follower counts require PostgreSQL",
    query = "FollowerCountQueryFailed: indexed follower count query failed",
  }, table.concat(branches, " UNION ALL "), values)
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
