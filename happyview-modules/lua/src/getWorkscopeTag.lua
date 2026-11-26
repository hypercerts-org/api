local function workscope_tag_get(uri)
  keys_only(params, { uri = true })
  local valid, collection = valid_record_uri(uri)
  if not uri or not valid or collection ~= WORKSCOPE_TAG then
    invalid("uri must be a full org.hypercerts.workscope.tag AT-URI with a DID authority")
  end

  local rows = workscope_tag_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { WORKSCOPE_TAG, uri })
  if #rows == 0 then error("RecordNotFound: work-scope tag is not indexed", 0) end

  local view = workscope_tag_view(rows[1])
  hydrate_actor_views({ view.author }, workscope_tag_query)
  return { workscopeTag = view }
end

function handle()
  return workscope_tag_get(scalar(params, "uri"))
end
