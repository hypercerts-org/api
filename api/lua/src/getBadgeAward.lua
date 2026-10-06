local AWARD = "app.certified.badge.award"
local DEFINITION = "app.certified.badge.definition"
local RESPONSE = "app.certified.badge.response"

local function valid_badge_award_uri(value)
  local valid, collection = valid_record_uri(value)
  return valid and collection == AWARD
end

local function query(sql, values)
  if db.backend() ~= "postgres" then
    error("BadgeAwardQueryFailed: badge award API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("BadgeAwardQueryFailed: badge award lookup failed", 0) end
  return result
end

local function recipient_did_expression()
  local subject = "award.record::jsonb->'subject'"
  return "CASE WHEN jsonb_typeof(" .. subject .. ") = 'string' THEN award.record::jsonb->>'subject' " ..
    "ELSE split_part(" .. subject .. "->>'uri', '/', 3) END"
end

local function get_badge_award(uri)
  local recipient_did = recipient_did_expression()
  local sql = "SELECT award.uri, award.did, award.cid, award.indexed_at::text AS indexed_at, " ..
    "award.record::text AS record, badge.uri AS badge_uri, badge.cid AS badge_cid, " ..
    "badge.indexed_at::text AS badge_indexed_at, badge.did AS badge_did, badge.record::text AS badge_record, " ..
    "recipient_response.uri AS recipient_response_uri, recipient_response.cid AS recipient_response_cid, " ..
    "recipient_response.indexed_at::text AS recipient_response_indexed_at, " ..
    "recipient_response.did AS recipient_response_did, recipient_response.record::text AS recipient_response_record " ..
    "FROM happyview_records AS award " ..
    "LEFT JOIN happyview_records AS badge ON badge.collection = $3 " ..
    "AND badge.uri = award.record::jsonb->'badge'->>'uri' " ..
    "AND badge.cid = award.record::jsonb->'badge'->>'cid' " ..
    "LEFT JOIN LATERAL (SELECT response.uri, response.cid, response.indexed_at, response.did, response.record " ..
    "FROM happyview_records AS response WHERE response.collection = $4 AND response.did = " .. recipient_did .. " " ..
    "AND response.record::jsonb->'badgeAward'->>'uri' = award.uri " ..
    "AND response.record::jsonb->'badgeAward'->>'cid' = award.cid " ..
    "AND response.record::jsonb->>'response' IN ('accepted', 'rejected') " ..
    "ORDER BY response.indexed_at DESC NULLS LAST, response.uri DESC LIMIT 1) AS recipient_response ON TRUE " ..
    "WHERE award.collection = $1 AND award.uri = $2 LIMIT 1"
  local rows = query(sql, { AWARD, uri, DEFINITION, RESPONSE })
  if #rows == 0 then error("RecordNotFound: badge award is not indexed", 0) end

  local row = rows[1]
  local view = record_view(row)
  view.indexedAt = row.indexed_at or NULL
  view.author = { did = view.did }
  if row.badge_uri ~= nil then
    view.badge = {
      uri = row.badge_uri,
      cid = row.badge_cid,
      indexedAt = row.badge_indexed_at or NULL,
      did = row.badge_did,
      record = json.decode(row.badge_record),
    }
  else
    view.badge = NULL
  end
  if row.recipient_response_uri ~= nil then
    local recipient_response = {
      uri = row.recipient_response_uri,
      cid = row.recipient_response_cid,
      indexedAt = row.recipient_response_indexed_at or NULL,
      did = row.recipient_response_did,
      record = json.decode(row.recipient_response_record),
    }
    view.responseStatus = recipient_response.record.response
    view.recipientResponse = recipient_response
  else
    view.responseStatus = "unanswered"
    view.recipientResponse = NULL
  end
  local author = view.author
  hydrate_actor_views({ author }, query)
  if author.profile ~= NULL then author.profile.indexedAt = author.profile.indexedAt or NULL end
  if author.organization ~= NULL then author.organization.indexedAt = author.organization.indexedAt or NULL end
  return { badgeAward = view }
end

local function handle_get_badge_award()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  if not uri or not valid_badge_award_uri(uri) then
    invalid("uri must be a full app.certified.badge.award AT-URI with a DID authority")
  end
  return get_badge_award(uri)
end

function handle()
  return handle_get_badge_award()
end
