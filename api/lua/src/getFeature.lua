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
