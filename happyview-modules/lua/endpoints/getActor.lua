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

-- luacheck: push ignore 211
-- Like scalar(), but a boolean comes back as "true" or "false": HappyView can hand
-- boolean-typed query parameters to Lua as booleans rather than strings.
local function scalar_or_boolean(values, key)
  if type(values[key]) == "boolean" then return tostring(values[key]) end
  return scalar(values, key)
end
-- luacheck: pop

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

-- luacheck: push ignore 211
-- For user-supplied filter values: bounds the size before parsing.
local function valid_bounded_record_uri(value)
  if type(value) ~= "string" or #value > 8192 then return false end
  return valid_record_uri(value)
end
-- luacheck: pop

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

-- luacheck: push ignore 211
-- Like record_view, but a row without indexed_at has no indexedAt key instead of JSON null.
-- Pass it to hydrate_actor_views for sidecars that preserve the omission.
local function record_view_omitting_indexed_at(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end
-- luacheck: pop

local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"

-- view(row) builds each profile/organization sidecar; it defaults to record_view.
local function hydrate_actor_views(actors, run_query, view)
  view = view or record_view
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
    actor.profile = profiles[actor.did] and view(profiles[actor.did]) or NULL
    actor.organization = organizations[actor.did] and view(organizations[actor.did]) or NULL
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

local function valid_handle(value)
  if type(value) ~= "string" or #value > 253 or value:find("[^%w%.%-]")
    or value:find("%.%.") or value:sub(1, 1) == "." or value:sub(-1) == "." then
    return false
  end
  local labels = 0
  for label in value:gmatch("[^%.]+") do
    labels = labels + 1
    if #label > 63 or label:sub(1, 1) == "-" or label:sub(-1) == "-" then return false end
  end
  return labels >= 2
end

local function encode_query_value(value)
  return (value:gsub("([^%w%.%-_~])", function(char)
    return string.format("%%%02X", string.byte(char))
  end))
end

local function fetch_resolver_json(url)
  local ok, response = pcall(http.get, url)
  if not ok or type(response) ~= "table" or type(response.status) ~= "number"
    or response.status < 200 or response.status >= 300 or type(response.body) ~= "string" then
    return nil
  end
  local decoded, value = pcall(json.decode, response.body)
  if not decoded or type(value) ~= "table" then return nil end
  return value
end

local DEFAULT_RESOLVER_URL = "https://slingshot.microcosm.blue"

local function resolver_base_url()
  local configured = type(env) == "table" and env.HYPERCERTS_HANDLE_RESOLVER_URL or nil
  -- Only an absent setting selects the default; a present but invalid value must still fail.
  if configured == nil then return DEFAULT_RESOLVER_URL end
  if type(configured) ~= "string" or #configured > 2048
    or configured:find("[%c%s]") or configured:find("\\", 1, true) or configured:find("%", 1, true) then
    return nil
  end

  local scheme, authority, suffix = configured:match("^([%a]+)://([^/?#]+)(.*)$")
  if not scheme or scheme:lower() ~= "https" or (suffix ~= "" and suffix ~= "/")
    or authority:find("@", 1, true) then
    return nil
  end
  return "https://" .. authority
end

local MINI_DOC_PATH = "/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier="

-- One best-effort lookup, for getActor only. HappyView Lua HTTP is serial, so
-- batch endpoints must not call this.
local function hydrate_actor_handle(actor)
  local base = resolver_base_url()
  if not base or type(http) ~= "table" or type(http.get) ~= "function" then return end

  local resolved = fetch_resolver_json(base .. MINI_DOC_PATH .. encode_query_value(actor.did))
  if resolved and resolved.did == actor.did and valid_handle(resolved.handle)
    and not resolved.handle:find("[^A-Za-z0-9.%-]") and resolved.handle:match("%.[A-Za-z][^.]*$") then
    local handle = resolved.handle:lower()
    if handle ~= "handle.invalid" then actor.handle = handle end
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

function handle()
  keys_only(params, { actor = true })
  local did = scalar(params, "actor")
  if not valid_did(did) then invalid("actor must be a valid DID") end

  local actor = lookup_actors({ did })[1]
  hydrate_actor_handle(actor)
  return { actor = actor }
end
