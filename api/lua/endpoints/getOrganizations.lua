local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"
local NULL = json.decode("null")

local function invalid(message)
  error("InvalidRequest: " .. message, 0)
end

local function keys_only(values, allowed)
  for key in pairs(values) do
    if not allowed[key] then invalid("unknown query parameter") end
  end
end

local function scalar(values, key)
  local value = values[key]
  if value == nil then return nil end
  if type(value) ~= "string" and type(value) ~= "number" then
    invalid(key .. " must occur once")
  end
  return tostring(value)
end

local function valid_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
end

local function query(sql, values)
  if db.backend() ~= "postgres" then error("OrganizationQueryFailed: organization API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("OrganizationQueryFailed: organization lookup failed", 0)
  end
  return result
end

local function record_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
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

local function valid_organization_batch_did(value)
  if not valid_did(value) then return false end

  local percent = value:find("%", 1, true)
  while percent do
    local escape = value:sub(percent + 1, percent + 2)
    if #escape ~= 2 or escape:find("[^%x]") then return false end
    percent = value:find("%", percent + 3, true)
  end
  return true
end

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
    if not valid_organization_batch_did(did) then invalid("each actors value must be a valid DID") end
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
