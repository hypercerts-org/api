local COLLECTION = VOCAB_TAG

local function query(sql, values)
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("VocabTagQueryFailed: vocabulary tag or publisher lookup failed", 0) end
  return result
end

local function get_vocab_tag()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  if not uri or not valid_vocab_tag_uri(uri) then
    invalid("uri must be a full org.hypercerts.vocab.tag AT-URI with a DID authority")
  end
  if db.backend() ~= "postgres" then
    error("VocabTagQueryFailed: vocabulary tag API requires PostgreSQL", 0)
  end

  local rows = query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { COLLECTION, uri })
  if #rows == 0 then error("RecordNotFound: vocabulary tag is not indexed", 0) end

  local view = record_view(rows[1])
  if rows[1].indexed_at == nil then view.indexedAt = json.decode("null") end
  view.author = { did = view.did }
  hydrate_vocab_actor_views({ view.author }, query)
  return { vocabTag = view }
end

function handle()
  return get_vocab_tag()
end
