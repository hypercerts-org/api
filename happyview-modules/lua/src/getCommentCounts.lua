local COMMENT_ATTACHMENT = "org.hypercerts.context.attachment"
local COMMENT_CONTENT_TYPE = "comment"

-- Counts comment records, not distinct authors. COUNT(DISTINCT uri) keeps a comment
-- that lists the same subject twice from counting twice. A non-array subjects value
-- expands to no rows, matching listAttachments.
local function comment_count_query(subjects)
  local backend_ok, backend = pcall(db.backend)
  if not backend_ok or backend ~= "postgres" then
    error("CommentCountQueryFailed: comment counts require PostgreSQL", 0)
  end

  local values, placeholders = { COMMENT_ATTACHMENT, COMMENT_CONTENT_TYPE }, {}
  for _, subject in ipairs(subjects) do
    values[#values + 1] = subject
    placeholders[#placeholders + 1] = "$" .. #values
  end

  local sql = "SELECT subject.value->>'uri' AS subject, COUNT(DISTINCT comment.uri) AS comment_count " ..
    "FROM happyview_records AS comment CROSS JOIN LATERAL jsonb_array_elements(" ..
    "CASE WHEN jsonb_typeof(comment.record::jsonb->'subjects') = 'array' " ..
    "THEN comment.record::jsonb->'subjects' ELSE '[]'::jsonb END) AS subject(value) " ..
    "WHERE comment.collection = $1 AND comment.record::jsonb->>'contentType' = $2 " ..
    "AND subject.value->>'uri' IN (" .. table.concat(placeholders, ", ") .. ") " ..
    "GROUP BY subject.value->>'uri'"
  local ok, rows = pcall(db.raw, sql, values)
  if not ok or type(rows) ~= "table" then
    error("CommentCountQueryFailed: indexed comment count query failed", 0)
  end
  return rows
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
