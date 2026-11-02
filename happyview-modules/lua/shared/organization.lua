local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"

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
  }
end

local function hydrate_organization_actors(actors)
  if #actors == 0 then return end

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
