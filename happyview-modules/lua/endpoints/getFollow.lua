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

-- Some clients wrote account follows whose `via` points at the followed
-- account's own org.hypercerts.collection, using the account follow as a
-- project follow. Those records stay indexed but are not account follows, so
-- every account-follow query applies this predicate in its WHERE clause, before
-- any per-relationship deduplication, so a user's genuine follow of the same
-- account is still found.
--
-- The rule is deliberately narrow: only a collection owned by the subject
-- matches. A starter pack, list, or collection owned by another DID is a real
-- mediating record and is kept. COALESCE keeps records with no usable `via`.
-- The expression only reads the row's own `record`, so it adds a per-row filter
-- on rows already selected by collection, subject, or publisher.
local function account_follow_filter_sql()
  return "NOT COALESCE(starts_with(record::jsonb->'via'->>'uri', 'at://' || (record::jsonb->>'subject') || '/org.hypercerts.collection/'), FALSE)"
end

local FOLLOW = "app.certified.graph.follow"

-- Guard the cast inside CASE; a WHERE filter cannot protect it from planner reordering.
local function follow_sort_key()
  local created = "record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(record::jsonb->'createdAt') = 'string' AND " .. created .. " ~ '" .. zoned .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created .. ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE COALESCE(indexed_at::timestamptz, created_at::timestamptz) END"
end

local function query(sql, values)
  if db.backend() ~= "postgres" then error("ActorFollowQueryFailed: actor-follow queries require PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("ActorFollowQueryFailed: actor-follow lookup failed", 0) end
  return result
end

local function query_follow(actor, subject)
  local rows = query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record FROM happyview_records CROSS JOIN LATERAL (SELECT " .. follow_sort_key() .. " AS sort_at) sorted WHERE collection = $1 AND did = $2 AND record::jsonb->>'subject' = $3 AND " .. account_follow_filter_sql() .. " ORDER BY sorted.sort_at ASC, uri ASC LIMIT 1",
    { FOLLOW, actor, subject })
  if #rows == 0 then return NULL end
  return record_view(rows[1])
end

local function get_follow()
  keys_only(params, { actor = true, subject = true })
  local actor = scalar(params, "actor")
  local subject = scalar(params, "subject")
  if not actor or not valid_did(actor) then invalid("actor must be a valid DID") end
  if not subject or not valid_did(subject) then invalid("subject must be a valid DID") end
  return { follow = query_follow(actor, subject) }
end

function handle()
  return get_follow()
end
