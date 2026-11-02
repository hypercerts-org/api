function handle()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  local valid, collection = measurement_valid_record_uri(uri)
  if not uri or not valid or collection ~= MEASUREMENT then
    invalid("uri must be a full " .. MEASUREMENT .. " AT-URI with a DID authority")
  end

  local rows = measurement_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { MEASUREMENT, uri })
  if #rows == 0 then error("RecordNotFound: measurement record is not indexed", 0) end

  local view = measurement_view(rows[1])
  hydrate_measurement_views({ view })
  return { measurement = view }
end
