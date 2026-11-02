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
