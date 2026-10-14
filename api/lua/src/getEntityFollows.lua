local function get_entity_follows()
  keys_only(params, { actor = true, entities = true })
  local actor = scalar(params, "actor")
  if not actor or not valid_did(actor) then invalid("actor must be a valid DID") end
  local function valid_nsid(value)
    if type(value) ~= "string" or #value > 317 then return false end
    local segments = {}
    for segment in value:gmatch("[^%.]+") do segments[#segments + 1] = segment end
    if #segments < 3 or table.concat(segments, ".") ~= value then return false end

    for _, segment in ipairs(segments) do
      if #segment > 63 or segment:find("[^A-Za-z0-9%-]")
        or segment:sub(1, 1) == "-" or segment:sub(-1) == "-" then
        return false
      end
    end

    if not segments[1]:sub(1, 1):match("^[A-Za-z]$") then return false end
    return segments[#segments]:match("^[A-Za-z][A-Za-z0-9]*$") ~= nil
  end

  local function valid_entity_uri(value)
    if #value > 8192 then return false end
    local valid, collection = valid_record_uri(value)
    return valid and valid_nsid(collection)
  end
  local entities, unique_entities = follow_batch_targets(
    actor, "entities", params.entities, valid_entity_uri,
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
