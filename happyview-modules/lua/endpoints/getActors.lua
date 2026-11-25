local function valid_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
end

-- valid_did allows "%" in a DID; the DID syntax requires two hex digits after it.
local function valid_did_percent_escapes(authority)
  local index = 1
  while index <= #authority do
    if authority:sub(index, index) == "%" then
      if not authority:sub(index + 1, index + 2):match("^%x%x$") then return false end
      index = index + 3
    else
      index = index + 1
    end
  end
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

local function valid_port(value)
  local port = tonumber(value)
  return port and port >= 1 and port <= 65535
end

local function valid_ipv4(value)
  if value:sub(1, 1) == "." or value:sub(-1) == "." or value:find("..", 1, true) then return false end
  local count = 0
  for octet in value:gmatch("[^%.]+") do
    local number = tonumber(octet)
    if not octet:match("^%d+$") or #octet > 3 or (#octet > 1 and octet:sub(1, 1) == "0")
      or not number or number > 255 then return false end
    count = count + 1
  end
  return count == 4
end

local function ipv6_group_count(part)
  if part == "" then return 0 end
  if part:sub(1, 1) == ":" or part:sub(-1) == ":" or part:find("::", 1, true) then return nil end
  local groups, count = {}, 0
  for group in part:gmatch("[^:]+") do groups[#groups + 1] = group end
  for index, group in ipairs(groups) do
    if group:find(".", 1, true) then
      if index ~= #groups or not valid_ipv4(group) then return nil end
      count = count + 2
    else
      if #group > 4 or not group:match("^%x+$") then return nil end
      count = count + 1
    end
  end
  return count
end

local function valid_ipv6(address)
  if not address:find(":", 1, true) then return false end
  local compression = address:find("::", 1, true)
  if compression then
    if address:find("::", compression + 2, true) or address:sub(1, compression - 1):find(".", 1, true) then
      return false
    end
    local left = ipv6_group_count(address:sub(1, compression - 1))
    local right = ipv6_group_count(address:sub(compression + 2))
    return left ~= nil and right ~= nil and left + right < 8
  end
  return ipv6_group_count(address) == 8
end

local function valid_resolver_authority(authority)
  if authority:find("@", 1, true) or authority:find("[^%w%.:%-%[%]]") then return false end

  if authority:sub(1, 1) == "[" then
    local address, port = authority:match("^%[([^%]]+)%]:(%d+)$")
    if not address then address = authority:match("^%[([^%]]+)%]$") end
    return address ~= nil and valid_ipv6(address) and (port == nil or valid_port(port))
  end

  local host, port = authority:match("^([%w%.%-]+):(%d+)$")
  if not host then
    host = authority
    if host:find(":", 1, true) then return false end
  end
  if port and not valid_port(port) then return false end
  if host:match("^[%d%.]+$") then return valid_ipv4(host) end
  if host == "" or #host > 253 or host:find("%.%.") or host:sub(1, 1) == "." or host:sub(-1) == "." then
    return false
  end
  for label in host:gmatch("[^%.]+") do
    if #label > 63 or label:sub(1, 1) == "-" or label:sub(-1) == "-" then return false end
  end
  return true
end

local function resolver_base_url()
  local configured = type(env) == "table" and env.HYPERCERTS_HANDLE_RESOLVER_URL or nil
  if type(configured) ~= "string" or #configured > 2048
    or configured:find("[%c%s]") or configured:find("\\", 1, true) or configured:find("%", 1, true) then
    return nil
  end

  local scheme, authority, suffix = configured:match("^([%a]+)://([^/?#]+)(.*)$")
  if not scheme or scheme:lower() ~= "https" or not authority
    or (suffix ~= "" and suffix ~= "/") or not valid_resolver_authority(authority) then
    return nil
  end
  return "https://" .. authority
end

local MAX_ACTOR_HANDLE_LOOKUPS = 50
local MINI_DOC_PATH = "/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier="

-- Actors are already unique and in first occurrence order. HTTP runs serially;
-- this budget bounds attempt count, not elapsed time.
local function hydrate_actor_handles(actors)
  local base = resolver_base_url()
  if not base or type(http) ~= "table" or type(http.get) ~= "function" then return end

  for index = 1, math.min(#actors, MAX_ACTOR_HANDLE_LOOKUPS) do
    local actor = actors[index]
    local resolved = fetch_resolver_json(base .. MINI_DOC_PATH .. encode_query_value(actor.did))
    if resolved and resolved.did == actor.did and valid_handle(resolved.handle)
      and not resolved.handle:find("[^A-Za-z0-9.%-]") and resolved.handle:match("%.[A-Za-z][^.]*$") then
      local handle = resolved.handle:lower()
      if handle ~= "handle.invalid" then actor.handle = handle end
    end
  end
end

local function valid_lookup_did(value)
  return valid_did(value) and valid_did_percent_escapes(value)
end

local function actor_query(sql, values)
  if db.backend() ~= "postgres" then error("ActorQueryFailed: actor API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ActorQueryFailed: indexed actor lookup failed", 0)
  end
  return result
end

local function lookup_actors(dids)
  local actors = {}
  for index, did in ipairs(dids) do
    actors[index] = { did = did, location = NULL }
  end
  hydrate_actor_views(actors, actor_query)
  hydrate_actor_locations(actors, actor_query)
  hydrate_actor_handles(actors)
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
  local dids, unique = requested_actor_dids(params, valid_lookup_did)
  local by_did = {}
  for _, actor in ipairs(lookup_actors(unique)) do by_did[actor.did] = actor end

  local actors = {}
  for index, did in ipairs(dids) do actors[index] = by_did[did] end
  return { actors = toarray(actors) }
end
