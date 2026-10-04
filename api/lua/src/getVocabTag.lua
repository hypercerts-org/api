local COLLECTION = "org.hypercerts.vocab.tag"

local function valid_vocab_did(value)
  if not valid_did(value) then return false end
  local position = 1
  while true do
    local percent = value:find("%", position, true)
    if not percent then return true end
    if not value:sub(percent + 1, percent + 2):match("^%x%x$") then return false end
    position = percent + 3
  end
end

local function valid_vocab_tag_uri(value)
  local valid, collection = valid_record_uri(value)
  if not valid or collection ~= COLLECTION then return false end
  local authority = value:match("^at://([^/]+)/")
  return valid_vocab_did(authority)
end

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
  hydrate_actor_views({ view.author }, query)
  return { vocabTag = view }
end

function handle()
  return get_vocab_tag()
end
