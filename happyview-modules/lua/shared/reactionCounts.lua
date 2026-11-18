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
