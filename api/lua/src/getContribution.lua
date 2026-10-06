function handle()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  if not valid_contribution_uri(uri) then
    invalid("uri must be a full org.hypercerts.claim.contribution AT-URI with a DID authority")
  end

  local rows = contribution_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { CONTRIBUTION, uri })
  if #rows == 0 then error("RecordNotFound: contribution record is not indexed", 0) end

  return { contribution = contribution_view(rows[1]) }
end
