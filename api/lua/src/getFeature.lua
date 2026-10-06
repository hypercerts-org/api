local FEATURE_VIEW_TYPE = "org.hypercerts.entity.defs#featureView"

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
