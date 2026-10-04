local RESPONSE = "app.certified.badge.response"

local function valid_badge_response_uri(value)
  local valid, collection = valid_record_uri(value)
  return valid and collection == RESPONSE
end

local function query(sql, values)
  if db.backend() ~= "postgres" then
    error("BadgeResponseQueryFailed: badge response API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("BadgeResponseQueryFailed: badge response lookup failed", 0) end
  return result
end

local function get_badge_response(uri)
  local rows = query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { RESPONSE, uri })
  if #rows == 0 then error("RecordNotFound: badge response is not indexed", 0) end
  local view = record_view(rows[1])
  view.indexedAt = rows[1].indexed_at or NULL
  view.author = { did = view.did }
  local author = view.author
  hydrate_actor_views({ author }, query)
  if author.profile ~= NULL then author.profile.indexedAt = author.profile.indexedAt or NULL end
  if author.organization ~= NULL then author.organization.indexedAt = author.organization.indexedAt or NULL end
  return { badgeResponse = view }
end

local function handle_get_badge_response()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  if not uri or not valid_badge_response_uri(uri) then
    invalid("uri must be a full app.certified.badge.response AT-URI with a DID authority")
  end
  return get_badge_response(uri)
end

function handle()
  return handle_get_badge_response()
end
