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
