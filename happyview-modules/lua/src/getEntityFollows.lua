local function get_entity_follows()
  keys_only(params, { actor = true, entities = true })
  local actor = scalar(params, "actor")
  if not actor or not valid_did(actor) then invalid("actor must be a valid DID") end
  local entities, unique_entities = follow_batch_targets(
    actor, "entities", params.entities, valid_entity_follow_uri,
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
