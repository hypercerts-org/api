local RIGHTS = "org.hypercerts.claim.rights"

local function rights_query(sql, values)
  if db.backend() ~= "postgres" then error("RightsQueryFailed: rights API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("RightsQueryFailed: rights lookup failed", 0)
  end
  return result
end

function handle()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  local valid, collection = rights_valid_record_uri(uri)
  if not uri or not valid or collection ~= RIGHTS then
    invalid("uri must be a full org.hypercerts.claim.rights AT-URI with a DID authority")
  end

  local rows = rights_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { RIGHTS, uri })
  if #rows == 0 then error("RecordNotFound: rights record is not indexed", 0) end

  local view = rights_record_view(rows[1])
  view.author = { did = view.did }
  rights_hydrate_actor_views({ view.author }, rights_query)
  return { rights = view }
end
