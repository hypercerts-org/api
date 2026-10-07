local function requested_organization_actors(value)
  if value == nil then invalid("actors is required") end

  local actors = {}
  if type(value) == "string" or type(value) == "number" then
    actors[1] = scalar(params, "actors")
  elseif type(value) == "table" then
    local occurrences = 0
    for index in pairs(value) do
      if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
        invalid("actors must use repeated query values")
      end
      occurrences = occurrences + 1
    end
    if occurrences ~= #value then invalid("actors must use repeated query values") end
    for index = 1, occurrences do
      if type(value[index]) ~= "string" then invalid("actors entries must be strings") end
      actors[#actors + 1] = value[index]
    end
  else
    invalid("actors must be a string or repeated string parameter")
  end

  if #actors < 1 or #actors > 100 then invalid("actors must contain 1 through 100 DIDs") end

  local unique, seen = {}, {}
  for _, did in ipairs(actors) do
    if not valid_did(did) then invalid("each actors value must be a valid DID") end
    if not seen[did] then
      seen[did] = true
      unique[#unique + 1] = did
    end
  end
  return actors, unique
end

function handle()
  keys_only(params, { actors = true })
  local actors, unique = requested_organization_actors(params.actors)

  local values, placeholders = { ORGANIZATION }, {}
  for _, did in ipairs(unique) do
    values[#values + 1] = did
    placeholders[#placeholders + 1] = "$" .. #values
  end
  local rows = query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(placeholders, ", ") .. ")",
    values)

  local organizations_by_did, organization_actors = {}, {}
  for _, row in ipairs(rows) do
    local actor = organization_actor_view(row)
    organizations_by_did[row.did] = actor
    organization_actors[#organization_actors + 1] = actor
  end
  hydrate_organization_actors(organization_actors)

  local organizations = {}
  for _, did in ipairs(actors) do
    organizations[#organizations + 1] = {
      actor = did,
      organization = organizations_by_did[did] or NULL,
    }
  end
  return { organizations = toarray(organizations) }
end
