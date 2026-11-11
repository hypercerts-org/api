local FOLLOW = "app.certified.graph.follow"
local ENTITY_FOLLOW = "app.certified.graph.entityFollow"

-- DIDs are account follows; anything else must be an entity-follow AT-URI.
local function valid_follower_count_subject(value)
  if value:sub(1, 4) == "did:" then return valid_did(value) end
  return valid_entity_follow_uri(value)
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
