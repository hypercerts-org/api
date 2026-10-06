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

local EVMLINK_COLLECTION = "app.certified.link.evm"

local function valid_evm_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  if not valid_did(value) then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific then return false end

  local segment_length, index = 0, 1
  while index <= #specific do
    local char = specific:sub(index, index)
    if char == ":" then
      if segment_length == 0 then return false end
      segment_length = 0
      index = index + 1
    elseif char == "%" then
      local escape = specific:sub(index + 1, index + 2)
      if #escape ~= 2 or escape:find("[^%x]") then return false end
      segment_length = segment_length + 1
      index = index + 3
    elseif char:match("^[%w._%-]$") then
      segment_length = segment_length + 1
      index = index + 1
    else
      return false
    end
  end
  return segment_length > 0
end

local function valid_evm_link_uri(value)
  if type(value) ~= "string" or value:find("[?#]") then return false end
  local valid, collection = valid_record_uri(value)
  if not valid or collection ~= EVMLINK_COLLECTION then return false end
  local authority = value:match("^at://([^/]+)/")
  return valid_evm_did(authority)
end

local function evm_link_record_view(row)
  local view = record_view(row)
  if view.indexedAt == nil then view.indexedAt = NULL end
  return view
end

local function normalize_evm_actor_indexed_at(actors)
  for _, actor in ipairs(actors) do
    for _, field in ipairs({ "profile", "organization" }) do
      local sidecar = actor[field]
      if sidecar ~= nil and sidecar ~= NULL and sidecar.indexedAt == nil then
        sidecar.indexedAt = NULL
      end
    end
  end
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

local EVMLINK = "app.certified.link.evm"

local function evm_link_query(sql, values)
  if db.backend() ~= "postgres" then
    error("EvmLinkQueryFailed: EVM-link API requires PostgreSQL", 0)
  end
  local ok, rows = pcall(db.raw, sql, values)
  if not ok then error("EvmLinkQueryFailed: EVM-link lookup failed", 0) end
  return rows
end

function handle()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  if not uri or not valid_evm_link_uri(uri) then
    invalid("uri must be a full app.certified.link.evm AT-URI with a DID authority")
  end

  local rows = evm_link_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { EVMLINK, uri })
  if #rows == 0 then error("RecordNotFound: EVM-link record is not indexed", 0) end

  local view = evm_link_record_view(rows[1])
  view.actor = { did = view.did }
  local hydrated_actors = { view.actor }
  hydrate_actor_views(hydrated_actors, evm_link_query)
  normalize_evm_actor_indexed_at(hydrated_actors)
  return { evmLink = view }
end
