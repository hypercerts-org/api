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

local function valid_datetime(value)
  if type(value) ~= "string" then return false end
  local year, month, day, hour, minute, second, suffix = value:match(
    "^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)(.*)$")
  if not year then return false end
  year, month, day = tonumber(year), tonumber(month), tonumber(day)
  if year < 1 then return false end
  hour, minute, second = tonumber(hour), tonumber(minute), tonumber(second)
  if month < 1 or month > 12 or hour > 23 or minute > 59 or second > 59 then return false end
  local leap = year % 4 == 0 and (year % 100 ~= 0 or year % 400 == 0)
  local month_days = { 31, leap and 29 or 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 }
  if day < 1 or day > month_days[month] then return false end
  local fraction, zone = suffix:match("^(%.%d+)(Z)$")
  if not fraction then fraction, zone = suffix:match("^(%.%d+)([+-]%d%d:%d%d)$") end
  if not fraction then zone = suffix:match("^(Z)$") end
  if not zone then zone = suffix:match("^([+-]%d%d:%d%d)$") end
  if not zone or zone == "-00:00" then return false end
  if zone ~= "Z" then
    local zh, zm = zone:match("^[+-](%d%d):(%d%d)$")
    if not zh or tonumber(zh) > 23 or tonumber(zm) > 59 then return false end
  end
  return true
end

local function parse_list_limit(params)
  local limit_value = scalar(params, "limit")
  if limit_value and not limit_value:match("^%d+$") then invalid("limit must be an integer from 1 through 100") end
  local limit = limit_value and tonumber(limit_value) or 25
  if not limit or limit % 1 ~= 0 or limit < 1 or limit > 100 then invalid("limit must be an integer from 1 through 100") end
  return limit
end

-- Hex-encodes the JSON of a cursor table.
local function cursor_encode(value)
  local encoded = json.encode(value)
  return (encoded:gsub(".", function(char) return string.format("%02x", string.byte(char)) end))
end

local function parse_sort_direction(params)
  local direction = scalar(params, "sortDirection") or "desc"
  if direction ~= "asc" and direction ~= "desc" then invalid("sortDirection must be 'asc' or 'desc'") end
  return direction
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

local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"

-- view(row) builds each profile/organization sidecar; it defaults to record_view.
local function hydrate_actor_views(actors, run_query, view)
  view = view or record_view
  if #actors == 0 then return end
  local dids, seen = {}, {}
  for _, actor in ipairs(actors) do
    if not seen[actor.did] then
      seen[actor.did] = true
      dids[#dids + 1] = actor.did
    end
  end
  local profiles, organizations = {}, {}
  local function load(collection, target)
    local params, marks = { collection }, {}
    for _, did in ipairs(dids) do
      params[#params + 1] = did
      marks[#marks + 1] = "$" .. #params
    end
    local rows = run_query("SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(marks, ",") .. ")", params)
    for _, row in ipairs(rows) do target[row.did] = row end
  end
  load(PROFILE, profiles)
  load(ORGANIZATION, organizations)
  for _, actor in ipairs(actors) do
    actor.profile = profiles[actor.did] and view(profiles[actor.did]) or NULL
    actor.organization = organizations[actor.did] and view(organizations[actor.did]) or NULL
  end
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

local CREATED_AT_SORT_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"

-- Sort key for a happyview_records row: the record's own createdAt when it is a
-- valid timestamp, otherwise COALESCE(indexed_at, created_at). `alias` is the
-- table alias; nil selects unqualified columns.
local function created_at_sort(alias)
  local prefix = alias and (alias .. ".") or ""
  local record, indexed_at, created_at = prefix .. "record", prefix .. "indexed_at", prefix .. "created_at"
  local created = record .. "::jsonb->>'createdAt'"
  return "CASE WHEN jsonb_typeof(" .. record .. "::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. CREATED_AT_SORT_PATTERN .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE COALESCE(" .. indexed_at ..
    "::timestamptz, " .. created_at .. "::timestamptz) END"
end

local FOLLOW = "app.certified.graph.follow"

local function query(sql, values)
  if db.backend() ~= "postgres" then error("ActorFollowQueryFailed: actor-follow queries require PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("ActorFollowQueryFailed: actor-follow lookup failed", 0) end
  return result
end

local function valid_follow_uri(value)
  local valid, collection = valid_record_uri(value)
  return valid and collection == FOLLOW
end

local function cursor_decode(token, direction)
  if not token then return nil end
  if #token % 2 ~= 0 or token:find("[^0-9a-f]") then invalid("cursor is malformed") end
  local decoded = token:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end)
  local ok, value = pcall(json.decode, decoded)
  if not ok or type(value) ~= "table" or value.v ~= 1 or value.d ~= direction
    or type(value.t) ~= "string" or type(value.u) ~= "string" then
    invalid("cursor is malformed or belongs to another sortDirection")
  end
  for key in pairs(value) do
    if key ~= "v" and key ~= "d" and key ~= "t" and key ~= "u" then invalid("cursor is malformed") end
  end
  if not valid_follow_uri(value.u) or not valid_datetime(value.t) then invalid("cursor is malformed") end
  return value
end

local function build_actor_follow_query(mode, actor, limit, cursor, direction)
  local filters, values = { "collection = $1", account_follow_filter_sql() }, { FOLLOW }
  values[#values + 1] = actor
  if mode == "followers" then
    filters[#filters + 1] = "record::jsonb->>'subject' = $2"
  else
    filters[#filters + 1] = "did = $2"
  end

  local cursor_filter = ""
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values .. "::timestamptz"
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    cursor_filter = " WHERE (sort_at, uri) " .. operator .. " (" .. timestamp .. ", " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local displayed_did = mode == "followers" and "did" or "subject_did"
  local sql = "WITH ranked_follows AS (SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record, record::jsonb->>'subject' AS subject_did, sorted.sort_at, ROW_NUMBER() OVER (PARTITION BY did, record::jsonb->>'subject' ORDER BY sorted.sort_at ASC, uri ASC) AS relationship_rank FROM happyview_records CROSS JOIN LATERAL (SELECT " .. created_at_sort() .. " AS sort_at) sorted WHERE " .. table.concat(filters, " AND ") .. "), representatives AS (SELECT uri, did, cid, indexed_at, record, sort_at, " .. displayed_did .. " AS actor_did FROM ranked_follows WHERE relationship_rank = 1), " ..
    "total AS (SELECT COUNT(*) AS total_count FROM representatives), " ..
    "page AS (SELECT uri, did, cid, indexed_at, record, sort_at, actor_did FROM representatives" .. cursor_filter .. " ORDER BY sort_at " .. ordering .. ", uri " .. ordering .. " LIMIT $" .. #values .. ") " ..
    "SELECT page.uri, page.did, page.cid, page.indexed_at, page.record, page.actor_did, total.total_count, to_char(page.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp FROM total LEFT JOIN page ON TRUE ORDER BY page.sort_at " .. ordering .. ", page.uri " .. ordering
  return sql, values
end

local function build_actor_follow_views(rows)
  local views = {}
  for _, row in ipairs(rows) do
    views[#views + 1] = { did = row.actor_did, follow = record_view(row) }
  end
  hydrate_actor_views(views, query)
  return views
end

local function query_actor_follows(mode, actor, limit, cursor, direction)
  local sql, values = build_actor_follow_query(mode, actor, limit, cursor, direction)
  local rows = query(sql, values)
  local total_count = rows[1] and tonumber(rows[1].total_count)
  if not total_count or total_count < 0 or total_count % 1 ~= 0 then error("ActorFollowQueryFailed: actor-follow count unavailable", 0) end
  if rows[1].uri == nil then rows = {} end
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local views = build_actor_follow_views(rows)
  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor, total_count
end

local function list_actor_follows(mode)
  keys_only(params, { actor = true, sortDirection = true, limit = true, cursor = true })
  local actor = scalar(params, "actor")
  if not actor or not valid_did(actor) then invalid("actor must be a valid DID") end

  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = cursor_decode(scalar(params, "cursor"), direction)
  local views, next_cursor, total_count = query_actor_follows(mode, actor, limit, cursor, direction)
  local response = { [mode] = toarray(views), totalCount = total_count }
  if next_cursor then response.cursor = next_cursor end
  return response
end

function handle()
  return list_actor_follows("followers")
end
