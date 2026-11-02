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

local function parse_sort_direction(params)
  local direction = scalar(params, "sortDirection") or "desc"
  if direction ~= "asc" and direction ~= "desc" then invalid("sortDirection must be 'asc' or 'desc'") end
  return direction
end

local function cursor_encode(value)
  local encoded = json.encode(value)
  return (encoded:gsub(".", function(char) return string.format("%02x", string.byte(char)) end))
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

local function hydrate_actor_views(actors, run_query)
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
    actor.profile = profiles[actor.did] and record_view(profiles[actor.did]) or NULL
    actor.organization = organizations[actor.did] and record_view(organizations[actor.did]) or NULL
  end
end

local FEED_REACTIONS = {
  likes = {
    collection = "app.certified.feed.like",
    output = "likes",
    count = "likeCount",
    failure = "LikeQueryFailed",
  },
  reposts = {
    collection = "app.certified.feed.repost",
    output = "reposts",
    count = "repostCount",
    failure = "RepostQueryFailed",
  },
}

local function feed_reaction_sort_key()
  local created = "record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(record::jsonb->'createdAt') = 'string' AND " .. created .. " ~ '" .. zoned .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created .. ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE COALESCE(indexed_at::timestamptz, created_at::timestamptz) END"
end

local function feed_reaction_query(reaction, sql, values)
  if db.backend() ~= "postgres" then error(reaction.failure .. ": reaction queries require PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error(reaction.failure .. ": indexed reaction query failed", 0) end
  return result
end

local function feed_reaction_decode_cursor(token, direction, collection)
  if token == nil then return nil end
  if #token == 0 or #token > 8192 or #token % 2 ~= 0 or token:find("[^0-9a-f]") then
    invalid("cursor is malformed")
  end
  local decoded = token:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end)
  local ok, value = pcall(json.decode, decoded)
  if not ok or type(value) ~= "table" or value.v ~= 1 or value.d ~= direction
    or type(value.t) ~= "string" or type(value.u) ~= "string" then
    invalid("cursor is malformed or belongs to another sortDirection")
  end
  for key in pairs(value) do
    if key ~= "v" and key ~= "d" and key ~= "t" and key ~= "u" then invalid("cursor is malformed") end
  end
  local valid, cursor_collection = valid_record_uri(value.u)
  if not valid or cursor_collection ~= collection or not valid_datetime(value.t) then
    invalid("cursor is malformed")
  end
  return value
end

local function feed_reaction_query_page(reaction, mode, identity, limit, cursor, direction)
  local filters, values = { "collection = $1" }, { reaction.collection, identity }
  if mode == "subject" then
    -- Subject identity is the AT-URI only; a newer CID must not split one reaction relationship.
    filters[#filters + 1] = "record::jsonb->'subject'->>'uri' = $2"
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
  local subject_uri = "record::jsonb->'subject'->>'uri'"
  -- Select the earliest representative before applying the caller's independent page direction.
  local sql = "WITH ranked_reactions AS (SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record, sorted.sort_at, ROW_NUMBER() OVER (PARTITION BY did, " .. subject_uri .. " ORDER BY sorted.sort_at ASC, uri ASC) AS relationship_rank FROM happyview_records CROSS JOIN LATERAL (SELECT " .. feed_reaction_sort_key() .. " AS sort_at) sorted WHERE " .. table.concat(filters, " AND ") .. "), " ..
    "representatives AS (SELECT uri, did, cid, indexed_at, record, sort_at FROM ranked_reactions WHERE relationship_rank = 1), "

  local page = "page AS (SELECT uri, did, cid, indexed_at, record, sort_at FROM representatives" .. cursor_filter .. " ORDER BY sort_at " .. ordering .. ", uri " .. ordering .. " LIMIT $" .. #values .. ") "
  local select_page = "SELECT page.uri, page.did, page.cid, page.indexed_at, page.record, to_char(page.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp "
  if mode == "subject" then
    sql = sql .. "total AS (SELECT COUNT(*) AS total_count FROM representatives), " .. page ..
      select_page .. ", total.total_count FROM total LEFT JOIN page ON TRUE ORDER BY page.sort_at " .. ordering .. ", page.uri " .. ordering
  else
    sql = sql .. page .. select_page .. "FROM page ORDER BY page.sort_at " .. ordering .. ", page.uri " .. ordering
  end
  return sql, values
end

local function feed_reaction_build_views(reaction, rows, mode)
  local views = {}
  for _, row in ipairs(rows) do
    if mode == "subject" then
      views[#views + 1] = { did = row.did, [reaction.output == "likes" and "like" or "repost"] = record_view(row) }
    else
      views[#views + 1] = record_view(row)
    end
  end
  if mode == "subject" then
    local ok = pcall(hydrate_actor_views, views, function(sql, values)
      return feed_reaction_query(reaction, sql, values)
    end)
    if not ok then error(reaction.failure .. ": actor hydration failed", 0) end
  end
  return views
end

local function feed_reaction_list(reaction_name, mode)
  local reaction = FEED_REACTIONS[reaction_name]
  local allowed = mode == "subject"
    and { subject = true, sortDirection = true, limit = true, cursor = true }
    or { actor = true, sortDirection = true, limit = true, cursor = true }
  keys_only(params, allowed)

  local identity = scalar(params, mode == "subject" and "subject" or "actor")
  if mode == "subject" then
    if not identity or #identity > 8192 or not valid_record_uri(identity) then
      invalid("subject must be a full DID-authority AT-URI")
    end
  elseif not identity or not valid_did(identity) then
    invalid("actor must be a valid DID")
  end

  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = feed_reaction_decode_cursor(scalar(params, "cursor"), direction, reaction.collection)
  local sql, values = feed_reaction_query_page(reaction, mode, identity, limit, cursor, direction)
  local rows = feed_reaction_query(reaction, sql, values)

  local total_count
  if mode == "subject" then
    total_count = rows[1] and tonumber(rows[1].total_count)
    if not total_count or total_count < 0 or total_count % 1 ~= 0 then
      error(reaction.failure .. ": distinct actor count unavailable", 0)
    end
    if rows[1].uri == nil then rows = {} end
  end

  local more = #rows > limit
  if more then rows[#rows] = nil end
  local ok, views = pcall(feed_reaction_build_views, reaction, rows, mode)
  if not ok then error(reaction.failure .. ": reaction view construction failed", 0) end

  local next_cursor
  if more then
    local last = rows[#rows]
    if not last or type(last.sort_timestamp) ~= "string" or type(last.uri) ~= "string" then
      error(reaction.failure .. ": next-page cursor fields unavailable", 0)
    end
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end

  local response = { [reaction.output] = toarray(views) }
  if mode == "subject" then response[reaction.count] = total_count end
  if next_cursor then response.cursor = next_cursor end
  return response
end

function handle()
  return feed_reaction_list("likes", "subject")
end
