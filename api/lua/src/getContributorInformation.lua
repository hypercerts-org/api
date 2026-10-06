local function contributor_information_query(sql, values)
  local backend_ok, backend = pcall(db.backend)
  if not backend_ok or backend ~= "postgres" then
    error("ContributorInformationQueryFailed: contributor-information queries require PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ContributorInformationQueryFailed: contributor-information lookup failed", 0)
  end
  return result
end

local function preserve_contributor_author_timestamps(author)
  for _, field in ipairs({ "profile", "organization" }) do
    local sidecar = author[field]
    if type(sidecar) == "table" and sidecar.uri ~= nil and sidecar.indexedAt == nil then
      sidecar.indexedAt = json.decode("null")
    end
  end
end

function handle()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  if not contributor_information_uri(uri) then
    invalid("uri must be a full org.hypercerts.claim.contributorInformation AT-URI with a DID authority")
  end

  local rows = contributor_information_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { CONTRIBUTOR_INFORMATION_COLLECTION, uri })
  if #rows == 0 then error("RecordNotFound: contributor-information record is not indexed", 0) end

  local view = record_view(rows[1])
  if rows[1].indexed_at == nil then view.indexedAt = json.decode("null") end
  local author = { did = rows[1].did }
  hydrate_actor_views({ author }, contributor_information_query)
  preserve_contributor_author_timestamps(author)
  view.author = author
  return { contributorInformation = view }
end
