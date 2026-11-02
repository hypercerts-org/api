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
