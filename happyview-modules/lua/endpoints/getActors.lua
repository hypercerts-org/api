local function valid_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
end

local function invalid(message)
  error("InvalidRequest: " .. message, 0)
end

local function keys_only(values, allowed, unknown_message_prefix)
  for key in pairs(values) do
    if not allowed[key] then
      invalid(unknown_message_prefix and (unknown_message_prefix .. key) or "unknown query parameter")
    end
  end
end

local function scalar(params, key)
  local value = params[key]
  if value == nil then return nil end
  if type(value) ~= "string" and type(value) ~= "number" then
    invalid(key .. " must occur once")
  end
  return tostring(value)
end

local function valid_record_key(value)
  return #value >= 1 and #value <= 512 and value ~= "." and value ~= ".."
    and not value:find("[^%w_~%.:%-]")
end

local function valid_record_uri(value)
  if type(value) ~= "string" or value:find("[?#]") then return false end
  local authority, collection, rkey = value:match("^at://([^/]+)/([^/]+)/([^/]+)$")
  if not authority or not valid_did(authority) or not valid_record_key(rkey) then return false end
  return true, collection, authority
end

local NULL = json.decode("null")

local function record_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and NULL or row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end

local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"

local function hydrate_actor_views(actors, run_query)
  if #actors == 0 then return end
  local dids, seen = {}, {}
  for _, actor in ipairs(actors) do
    if not seen[actor.did] then
      seen[actor.did] = true
      dids[#dids + 1] = actor.did
    end
  end
  local profiles, organizations = {}, {}
  local function load(collection, target)
    local params, marks = { collection }, {}
    for _, did in ipairs(dids) do
      params[#params + 1] = did
      marks[#marks + 1] = "$" .. #params
    end
    local rows = run_query("SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(marks, ",") .. ")", params)
    for _, row in ipairs(rows) do target[row.did] = row end
  end
  load(PROFILE, profiles)
  load(ORGANIZATION, organizations)
  for _, actor in ipairs(actors) do
    actor.profile = profiles[actor.did] and record_view(profiles[actor.did]) or NULL
    actor.organization = organizations[actor.did] and record_view(organizations[actor.did]) or NULL
  end
end

local LOCATION = "app.certified.location"

-- Match only the URI: the indexed version may differ from the organization's pinned CID.
local function location_uri(organization)
  if organization == NULL then return nil end
  local reference = organization.record.location
  if type(reference) ~= "table" or type(reference.uri) ~= "string" then return nil end
  local valid, collection = valid_record_uri(reference.uri)
  if valid and collection == LOCATION then return reference.uri end
  return nil
end

local function hydrate_actor_locations(actors, run_query)
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
  local rows = run_query(
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

local function actor_query(sql, values)
  if db.backend() ~= "postgres" then error("ActorQueryFailed: actor API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ActorQueryFailed: indexed actor lookup failed", 0)
  end
  return result
end

-- run_query defaults to the actor API's own error mapping; the organization
-- endpoints pass theirs so their documented OrganizationQueryFailed is kept.
local function lookup_actors(dids, run_query)
  run_query = run_query or actor_query
  local actors = {}
  for index, did in ipairs(dids) do
    actors[index] = { did = did, location = NULL }
  end
  hydrate_actor_views(actors, run_query)
  hydrate_actor_locations(actors, run_query)
  return actors
end

local function requested_actor_dids(params, validate_did)
  local value = params.actors
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
    if not validate_did(did) then invalid("each actors value must be a valid DID") end
    if not seen[did] then
      seen[did] = true
      unique[#unique + 1] = did
    end
  end
  return actors, unique
end

function handle()
  keys_only(params, { actors = true })
  local dids, unique = requested_actor_dids(params, valid_did)
  local by_did = {}
  for _, actor in ipairs(lookup_actors(unique)) do by_did[actor.did] = actor end

  local actors = {}
  for index, did in ipairs(dids) do actors[index] = by_did[did] end
  return { actors = toarray(actors) }
end
