local function invalid(message)
  error("InvalidRequest: " .. message, 0)
end

local function keys_only(values, allowed)
  for key in pairs(values) do
    if not allowed[key] then invalid("unknown query parameter") end
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

local function valid_did(value)
  if #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
end

local function valid_record_key(value)
  return #value >= 1 and #value <= 512 and value ~= "." and value ~= ".."
    and not value:find("[^%w_~%.:%-]")
end

local function valid_record_uri(value)
  if type(value) ~= "string" or value:find("[?#]") then return false end
  local authority, collection, rkey = value:match("^at://([^/]+)/([^/]+)/([^/]+)$")
  if not authority or not valid_did(authority) or not valid_record_key(rkey) then return false end
  return true, collection
end

local FEATURE_PROJECTION_PROFILE = "app.certified.actor.profile"
local FEATURE_PROJECTION_ORGANIZATION = "app.certified.actor.organization"
local FEATURE_PROJECTION_NULL = json.decode("null")

local function feature_projection_query(sql, values)
  if db.backend() ~= "postgres" then
    error("CollectionQueryFailed: collection API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("CollectionQueryFailed: collection lookup failed", 0)
  end
  return result
end

local function feature_projection_load_actor_records(collection, dids)
  if #dids == 0 then return {} end
  local values, placeholders = { collection }, {}
  for _, did in ipairs(dids) do
    values[#values + 1] = did
    placeholders[#placeholders + 1] = "$" .. #values
  end
  local rows = feature_projection_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(placeholders, ", ") .. ")",
    values)
  local by_did = {}
  for _, row in ipairs(rows) do by_did[row.did] = row end
  return by_did
end

local function feature_projection_record_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and FEATURE_PROJECTION_NULL or row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end

local function feature_projection_view(row)
  return {
    ["$type"] = "org.hypercerts.collection.listCollectionItems#featureView",
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and FEATURE_PROJECTION_NULL or row.indexed_at,
    did = row.did,
    author = { did = row.did },
    record = json.decode(row.record),
  }
end

local function feature_projection_hydrate(views)
  if #views == 0 then return end
  local dids, seen = {}, {}
  for _, view in ipairs(views) do
    if not seen[view.did] then
      seen[view.did] = true
      dids[#dids + 1] = view.did
    end
  end
  local profiles = feature_projection_load_actor_records(FEATURE_PROJECTION_PROFILE, dids)
  local organizations = feature_projection_load_actor_records(FEATURE_PROJECTION_ORGANIZATION, dids)
  for _, view in ipairs(views) do
    view.author.profile = profiles[view.did] and feature_projection_record_view(profiles[view.did]) or FEATURE_PROJECTION_NULL
    view.author.organization = organizations[view.did] and feature_projection_record_view(organizations[view.did]) or FEATURE_PROJECTION_NULL
  end
end

local FEATURE_COLLECTION = "org.hypercerts.entity.feature"
local FEATURE_VIEW_TYPE = "org.hypercerts.entity.defs#featureView"

local function feature_valid_did(value)
  if not valid_did(value) then return false end
  local position = 1
  while true do
    local escape_start = value:find("%", position, true)
    if not escape_start then return true end
    local escape = value:sub(escape_start + 1, escape_start + 2)
    if not escape:match("^[0-9a-fA-F][0-9a-fA-F]$") then return false end
    position = escape_start + 3
  end
end

local function feature_valid_uri(value)
  if type(value) ~= "string" or #value > 8192 then return false end
  local valid, collection = valid_record_uri(value)
  if not valid or collection ~= FEATURE_COLLECTION then return false end
  local authority = value:match("^at://([^/]+)/")
  return feature_valid_did(authority)
end

local function feature_lookup(uri)
  if db.backend() ~= "postgres" then
    error("FeatureQueryFailed: feature API requires PostgreSQL", 0)
  end
  local ok, rows = pcall(db.raw,
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { FEATURE_COLLECTION, uri })
  if not ok or type(rows) ~= "table" then
    error("FeatureQueryFailed: feature lookup failed", 0)
  end
  local views = {}
  for _, row in ipairs(rows) do
    local view = feature_projection_view(row)
    view["$type"] = FEATURE_VIEW_TYPE
    views[#views + 1] = view
  end
  feature_projection_hydrate(views)
  return views
end

local function get_feature()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  if not uri or not feature_valid_uri(uri) then
    invalid("uri must be a full org.hypercerts.entity.feature AT-URI with a DID authority")
  end
  local views = feature_lookup(uri)
  if #views == 0 then error("RecordNotFound: feature record is not indexed", 0) end
  return { feature = views[1] }
end

function handle()
  return get_feature()
end
