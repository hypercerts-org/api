function handle()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  local valid, collection = valid_record_uri(uri)
  if not uri or not valid or collection ~= ACKNOWLEDGEMENT then
    invalid("uri must be a full org.hypercerts.context.acknowledgement AT-URI with a DID authority")
  end

  local rows = acknowledgement_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { ACKNOWLEDGEMENT, uri })
  if #rows == 0 then error("RecordNotFound: acknowledgement record is not indexed", 0) end

  local acknowledgement = acknowledgement_record_view(rows[1])
  hydrate_acknowledgement_authors({ acknowledgement })
  return { acknowledgement = acknowledgement }
end
