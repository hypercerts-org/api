local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"
local LOCATION = "app.certified.location"

local function query(sql, values)
  if db.backend() ~= "postgres" then error("OrganizationQueryFailed: organization API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("OrganizationQueryFailed: organization lookup failed", 0)
  end
  return result
end

local function organization_actor_view(row)
  return {
    did = row.did,
    profile = NULL,
    organization = record_view(row),
    location = NULL,
  }
end

local function hydrate_profiles(actors)
  local dids, seen = {}, {}
  for _, actor in ipairs(actors) do
    if not seen[actor.did] then
      seen[actor.did] = true
      dids[#dids + 1] = actor.did
    end
  end

  local values, marks = { PROFILE }, {}
  for _, did in ipairs(dids) do
    values[#values + 1] = did
    marks[#marks + 1] = "$" .. #values
  end
  local rows = query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(marks, ", ") .. ")",
    values)
  local profiles = {}
  for _, row in ipairs(rows) do profiles[row.did] = row end
  for _, actor in ipairs(actors) do
    actor.profile = profiles[actor.did] and record_view(profiles[actor.did]) or NULL
  end
end

-- The organization's location reference pins a CID, but the lookup matches the URI only, so a newer
-- indexed version is returned as-is. Anything that is not a location record URI yields no lookup.
local function location_uri(organization)
  local reference = organization.record.location
  if type(reference) ~= "table" or type(reference.uri) ~= "string" then return nil end
  local valid, collection = valid_record_uri(reference.uri)
  if valid and collection == LOCATION then return reference.uri end
  return nil
end

local function hydrate_locations(actors)
  local uris, seen = {}, {}
  for _, actor in ipairs(actors) do
    local uri = location_uri(actor.organization)
    if uri and not seen[uri] then
      seen[uri] = true
      uris[#uris + 1] = uri
    end
  end
  if #uris == 0 then return end

  local values, marks = { LOCATION }, {}
  for _, uri in ipairs(uris) do
    values[#values + 1] = uri
    marks[#marks + 1] = "$" .. #values
  end
  local rows = query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri IN (" .. table.concat(marks, ", ") .. ")",
    values)
  local locations = {}
  for _, row in ipairs(rows) do locations[row.uri] = row end
  for _, actor in ipairs(actors) do
    local uri = location_uri(actor.organization)
    if uri and locations[uri] then actor.location = record_view(locations[uri]) end
  end
end

local function hydrate_organization_actors(actors)
  if #actors == 0 then return end
  hydrate_profiles(actors)
  hydrate_locations(actors)
end
