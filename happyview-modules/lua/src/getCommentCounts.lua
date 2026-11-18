local function comment_count_query(subjects)
  local values = {}
  local sql = ref_counts.comment_sql(values, subjects)
  return ref_counts.run({
    backend = "CommentCountQueryFailed: comment counts require PostgreSQL",
    query = "CommentCountQueryFailed: indexed comment count query failed",
  }, sql, values)
end

local function comment_count_number(value)
  local count = tonumber(value)
  if not count or count < 0 or count % 1 ~= 0 then
    error("CommentCountQueryFailed: indexed comment count was unavailable", 0)
  end
  return count
end

local function get_comment_counts()
  keys_only(params, { subjects = true })
  -- A single subject arrives as a plain value; read it like getReactionCounts does.
  local subjects_param = params.subjects
  if type(subjects_param) == "string" then subjects_param = scalar(params, "subjects") end
  local subjects, unique_subjects = follow_batch_targets(
    nil, "subjects", subjects_param, valid_subject_record_uri,
    "a full AT-URI with a DID authority and valid collection NSID",
    "org.hypercerts.context.getCommentCounts")

  local counts_by_subject = {}
  for _, row in ipairs(comment_count_query(unique_subjects)) do
    if type(row) ~= "table" or type(row.subject) ~= "string" then
      error("CommentCountQueryFailed: indexed comment count subject was unavailable", 0)
    end
    counts_by_subject[row.subject] = comment_count_number(row.comment_count)
  end

  local counts = {}
  for _, subject in ipairs(subjects) do
    counts[#counts + 1] = { subject = subject, commentCount = counts_by_subject[subject] or 0 }
  end
  return { counts = toarray(counts) }
end

function handle()
  return get_comment_counts()
end
