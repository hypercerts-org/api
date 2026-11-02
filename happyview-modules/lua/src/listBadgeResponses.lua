local RESPONSE = "app.certified.badge.response"
local AWARD = "app.certified.badge.award"

local function valid_badge_response_uri(value)
  local valid, collection = valid_record_uri(value)
  return valid and collection == RESPONSE
end

local function valid_badge_award_uri(value)
  local valid, collection = valid_record_uri(value)
  return valid and collection == AWARD
end

local function query(sql, values)
  if db.backend() ~= "postgres" then
    error("BadgeResponseQueryFailed: badge response API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("BadgeResponseQueryFailed: badge response query failed", 0) end
  return result
end

local function decode_badge_response_cursor(token, direction)
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
  if not valid_datetime(value.t) or not valid_badge_response_uri(value.u) then invalid("cursor is malformed") end
  return value
end

local function response_sort_expression()
  local created = "response.record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(response.record::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. zoned .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE " ..
    "COALESCE(response.indexed_at::timestamptz, response.created_at::timestamptz) END"
end

local function list_badge_responses(badge_award, limit, cursor, direction)
  local where, values = { "response.collection = $1" }, { RESPONSE }
  if badge_award then
    values[#values + 1] = badge_award
    where[#where + 1] = "response.record::jsonb->'badgeAward'->>'uri' = $" .. #values
  end
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, response.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end
  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT response.uri, response.did, response.cid, response.indexed_at::text AS indexed_at, " ..
    "response.record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', " ..
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records AS response CROSS JOIN LATERAL (SELECT " .. response_sort_expression() .. " AS sort_at) sorted " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", response.uri " .. ordering .. " LIMIT $" .. #values
  local rows = query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end
  local views, authors = {}, {}
  for _, row in ipairs(rows) do
    local view = record_view(row)
    view.indexedAt = row.indexed_at or NULL
    view.author = { did = view.did }
    views[#views + 1] = view
    authors[#authors + 1] = view.author
  end
  hydrate_actor_views(authors, query)
  for _, author in ipairs(authors) do
    if author.profile ~= NULL then
      author.profile.indexedAt = author.profile.indexedAt or NULL
    end
    if author.organization ~= NULL then
      author.organization.indexedAt = author.organization.indexedAt or NULL
    end
  end
  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return views, next_cursor
end

local function handle_list_badge_responses()
  keys_only(params, { badgeAward = true, sortDirection = true, limit = true, cursor = true })
  local badge_award = scalar(params, "badgeAward")
  if badge_award and not valid_badge_award_uri(badge_award) then
    invalid("badgeAward must be a full app.certified.badge.award AT-URI with a DID authority")
  end
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = decode_badge_response_cursor(scalar(params, "cursor"), direction)
  local views, next_cursor = list_badge_responses(badge_award, limit, cursor, direction)
  local result = { badgeResponses = toarray(views) }
  if next_cursor then result.cursor = next_cursor end
  return result
end

function handle()
  return handle_list_badge_responses()
end
