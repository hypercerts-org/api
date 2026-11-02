local function valid_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
end

local function invalid(message)
  error("InvalidRequest: " .. message, 0)
end

local function keys_only(values, allowed, unknown_message_prefix)
  for key in pairs(values) do
    if not allowed[key] then
      invalid(unknown_message_prefix and (unknown_message_prefix .. key) or "unknown query parameter")
    end
  end
end

local function scalar(params, key)
  local value = params[key]
  if value == nil then return nil end
  if type(value) ~= "string" and type(value) ~= "number" then
    invalid(key .. " must occur once")
  end
  return tostring(value)
end

local function valid_record_key(value)
  return #value >= 1 and #value <= 512 and value ~= "." and value ~= ".."
    and not value:find("[^%w_~%.:%-]")
end

local function valid_record_uri(value)
  if type(value) ~= "string" or value:find("[?#]") then return false end
  local authority, collection, rkey = value:match("^at://([^/]+)/([^/]+)/([^/]+)$")
  if not authority or not valid_did(authority) or not valid_record_key(rkey) then return false end
  return true, collection, authority
end

local NULL = json.decode("null")

local function record_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and NULL or row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end

local ACTOR_REACTION_NULL = json.decode("null")
local ACTOR_REACTION_LIMIT = 100
local ACTOR_REACTION_COLLECTIONS = {
  like = "app.certified.feed.like",
  repost = "app.certified.feed.repost",
}

local function actor_reaction_sort_key()
  -- Keep representative selection aligned with feedReaction.lua's validated createdAt fallback.
  local created = "record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(record::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. zoned .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE COALESCE(indexed_at::timestamptz, created_at::timestamptz) END"
end

local function valid_actor_reaction_nsid(value)
  if type(value) ~= "string" or #value > 317 then return false end
  local segments = {}
  for segment in value:gmatch("[^%.]+") do segments[#segments + 1] = segment end
  if #segments < 3 or table.concat(segments, ".") ~= value then return false end
  for index = 1, #segments - 1 do
    local segment = segments[index]
    if #segment > 63 or segment:find("[^A-Za-z0-9%-]") then return false end
    local first, last = segment:sub(1, 1), segment:sub(-1)
    if not first:match(index == 1 and "^[A-Za-z]$" or "^[A-Za-z0-9]$")
      or not last:match("^[A-Za-z0-9]$") then return false end
  end
  local name = segments[#segments]
  return #name <= 63 and name:match("^[A-Za-z][A-Za-z0-9]*$") ~= nil
end

local function valid_actor_reaction_subject_uri(value)
  local valid, collection = valid_record_uri(value)
  return valid and valid_actor_reaction_nsid(collection)
end

local function feed_actor_reaction_subjects(value)
  if value == nil then invalid("subjects is required") end

  local subjects = {}
  if type(value) == "string" then
    subjects[1] = value
  elseif type(value) == "table" then
    local occurrences = 0
    for index in pairs(value) do
      if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
        invalid("subjects must use repeated query values")
      end
      occurrences = occurrences + 1
    end
    if occurrences ~= #value then invalid("subjects must use repeated query values") end
    for index = 1, occurrences do
      if type(value[index]) ~= "string" then invalid("subjects entries must be strings") end
      subjects[#subjects + 1] = value[index]
    end
  else
    invalid("subjects must be a string or repeated string parameter")
  end

  if #subjects < 1 or #subjects > ACTOR_REACTION_LIMIT then
    invalid("subjects must contain 1 through 100 AT-URIs")
  end
  for _, subject in ipairs(subjects) do
    if #subject > 8192 or not valid_actor_reaction_subject_uri(subject) then
      invalid("each subjects value must be a full DID-authority AT-URI with a valid collection NSID")
    end
  end
  return subjects
end

local function feed_actor_reactions_query(actor, subjects)
  local backend_ok, backend = pcall(db.backend)
  if not backend_ok or backend ~= "postgres" then
    error("ActorReactionsQueryFailed: actor reaction queries require PostgreSQL", 0)
  end

  local values, requested_rows = { actor }, {}
  for ordinal, subject in ipairs(subjects) do
    values[#values + 1] = subject
    requested_rows[#requested_rows + 1] = "($" .. #values .. ", " .. ordinal .. ")"
  end

  local likes = ACTOR_REACTION_COLLECTIONS.like
  local reposts = ACTOR_REACTION_COLLECTIONS.repost
  local sort_key = actor_reaction_sort_key()
  local sql = "WITH requested(requested_subject, request_ordinal) AS (VALUES " .. table.concat(requested_rows, ", ") .. "), " ..
    "requested_unique AS (SELECT DISTINCT requested_subject FROM requested), " ..
    "ranked_reactions AS (SELECT reaction.collection, reaction.record::jsonb->'subject'->>'uri' AS subject_uri, " ..
      "reaction.uri, reaction.did, reaction.cid, reaction.indexed_at::text AS indexed_at, reaction.record::text AS record, " ..
      "ROW_NUMBER() OVER (PARTITION BY reaction.collection, reaction.record::jsonb->'subject'->>'uri' " ..
      "ORDER BY sorted.sort_at ASC, reaction.uri ASC) AS reaction_rank " ..
      "FROM happyview_records reaction JOIN requested_unique requested " ..
      "ON requested.requested_subject = reaction.record::jsonb->'subject'->>'uri' " ..
      "CROSS JOIN LATERAL (SELECT " .. sort_key .. " AS sort_at) sorted " ..
      "WHERE reaction.did = $1 AND reaction.collection IN ('" .. likes .. "', '" .. reposts .. "')), " ..
    "representatives AS (SELECT collection, subject_uri, uri, did, cid, indexed_at, record " ..
      "FROM ranked_reactions WHERE reaction_rank = 1) " ..
    "SELECT requested.request_ordinal, requested.requested_subject, " ..
      "(likes.uri IS NOT NULL) AS like_present, likes.uri AS like_uri, likes.cid AS like_cid, " ..
      "likes.indexed_at AS like_indexed_at, likes.did AS like_did, likes.record AS like_record, " ..
      "(reposts.uri IS NOT NULL) AS repost_present, reposts.uri AS repost_uri, reposts.cid AS repost_cid, " ..
      "reposts.indexed_at AS repost_indexed_at, reposts.did AS repost_did, reposts.record AS repost_record " ..
      "FROM requested " ..
      "LEFT JOIN representatives likes ON likes.collection = '" .. likes .. "' " ..
      "AND likes.subject_uri = requested.requested_subject " ..
      "LEFT JOIN representatives reposts ON reposts.collection = '" .. reposts .. "' " ..
      "AND reposts.subject_uri = requested.requested_subject " ..
      "ORDER BY requested.request_ordinal"

  local ok, rows = pcall(db.raw, sql, values)
  if not ok or type(rows) ~= "table" then
    error("ActorReactionsQueryFailed: indexed actor reactions could not be queried", 0)
  end
  return rows
end

local function feed_actor_reaction_record_view(row, prefix, collection, actor, subject)
  local present = row[prefix .. "_present"]
  local uri = row[prefix .. "_uri"]
  local cid = row[prefix .. "_cid"]
  local indexed_at = row[prefix .. "_indexed_at"]
  local did = row[prefix .. "_did"]
  local record = row[prefix .. "_record"]

  if type(present) ~= "boolean" then error("reaction presence flag is malformed", 0) end
  if not present then
    if uri ~= nil or cid ~= nil or indexed_at ~= nil or did ~= nil or record ~= nil then
      error("missing reaction contains partial record fields", 0)
    end
    return ACTOR_REACTION_NULL
  end

  local valid, record_collection, record_did = valid_record_uri(uri)
  if not valid or record_collection ~= collection or record_did ~= actor
    or did ~= actor or not valid_did(did) or type(cid) ~= "string" or #cid == 0
    or (indexed_at ~= nil and type(indexed_at) ~= "string") or type(record) ~= "string" then
    error("reaction record fields are malformed", 0)
  end

  local ok, view = pcall(record_view, {
    uri = uri,
    cid = cid,
    indexed_at = indexed_at,
    did = did,
    record = record,
  })
  if not ok or type(view) ~= "table" or type(view.record) ~= "table"
    or view.record == ACTOR_REACTION_NULL or type(view.record.subject) ~= "table"
    or view.record.subject.uri ~= subject then
    error("reaction record could not be decoded for its requested subject", 0)
  end
  return view
end

local function feed_actor_reaction_results(rows, actor, subjects)
  if #rows ~= #subjects then error("query result count does not match requested subjects", 0) end

  local by_ordinal = {}
  for _, row in ipairs(rows) do
    if type(row) ~= "table" or type(row.request_ordinal) ~= "number"
      or row.request_ordinal % 1 ~= 0 or row.request_ordinal < 1
      or row.request_ordinal > #subjects or by_ordinal[row.request_ordinal] ~= nil
      or row.requested_subject ~= subjects[row.request_ordinal] then
      error("query returned a malformed subject result", 0)
    end

    local subject = subjects[row.request_ordinal]
    by_ordinal[row.request_ordinal] = {
      subject = subject,
      like = feed_actor_reaction_record_view(row, "like", ACTOR_REACTION_COLLECTIONS.like, actor, subject),
      repost = feed_actor_reaction_record_view(row, "repost", ACTOR_REACTION_COLLECTIONS.repost, actor, subject),
    }
  end

  local results = {}
  for ordinal = 1, #subjects do
    if by_ordinal[ordinal] == nil then error("query omitted a requested subject result", 0) end
    results[ordinal] = by_ordinal[ordinal]
  end
  return { results = toarray(results) }
end

local function feed_actor_reactions()
  keys_only(params, { actor = true, subjects = true })
  local actor = scalar(params, "actor")
  if not actor or not valid_did(actor) then invalid("actor must be a valid DID") end
  local subjects = feed_actor_reaction_subjects(params.subjects)
  local rows = feed_actor_reactions_query(actor, subjects)
  local ok, response = pcall(feed_actor_reaction_results, rows, actor, subjects)
  if not ok then
    error("ActorReactionsQueryFailed: indexed actor reactions returned malformed data", 0)
  end
  return response
end

function handle()
  return feed_actor_reactions()
end
