local function invalid(message)
  error("InvalidRequest: " .. message, 0)
end

local function keys_only(values, allowed)
  for key in pairs(values) do
    if not allowed[key] then invalid("unknown query parameter") end
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

local function valid_did(value)
  if #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
end

local function valid_record_key(value)
  return #value >= 1 and #value <= 512 and value ~= "." and value ~= ".."
    and not value:find("[^%w_~%.:%-]")
end

local function valid_record_uri(value)
  if type(value) ~= "string" or value:find("[?#]") then return false end
  local authority, collection, rkey = value:match("^at://([^/]+)/([^/]+)/([^/]+)$")
  if not authority or not valid_did(authority) or not valid_record_key(rkey) then return false end
  return true, collection
end

local function valid_datetime(value)
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
    indexedAt = row.indexed_at,
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

local AWARD = "app.certified.badge.award"
local DEFINITION = "app.certified.badge.definition"
local RESPONSE = "app.certified.badge.response"
local RESPONSE_STATUSES = { accepted = true, rejected = true, unanswered = true }

local function valid_badge_award_uri(value)
  local valid, collection = valid_record_uri(value)
  return valid and collection == AWARD
end

local function valid_badge_definition_uri(value)
  local valid, collection = valid_record_uri(value)
  return valid and collection == DEFINITION
end

local function valid_badge_subject_nsid(value)
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

local function query(sql, values)
  if db.backend() ~= "postgres" then
    error("BadgeAwardQueryFailed: badge award API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("BadgeAwardQueryFailed: badge award query failed", 0) end
  return result
end

local function array_values(key, validate, description, max_bytes)
  local value = params[key]
  if value == nil then return nil end
  local values = {}
  if type(value) == "string" then values[1] = value
  elseif type(value) == "table" then
    for i = 1, #value do
      if type(value[i]) ~= "string" then invalid(key .. " entries must be strings") end
      values[#values + 1] = value[i]
    end
  else invalid(key .. " must be a string or repeated string parameter") end
  if #values > 100 then invalid(key .. " accepts at most 100 values") end
  local unique, seen = {}, {}
  for _, item in ipairs(values) do
    if max_bytes and #item > max_bytes then
      invalid(key .. " entries must be at most " .. max_bytes .. " UTF-8 bytes")
    end
    if validate and not validate(item) then invalid("each " .. key .. " value must be " .. description) end
    if not seen[item] then seen[item] = true; unique[#unique + 1] = item end
  end
  return unique
end

local function subject_values()
  local value = params.subjects
  if value == nil then return nil end
  local items = {}
  if type(value) == "string" then items[1] = value
  elseif type(value) == "table" then
    for i = 1, #value do
      if type(value[i]) ~= "string" then
        invalid("subjects[" .. i .. "] must be a valid DID or full record AT-URI")
      end
      items[#items + 1] = value[i]
    end
  else invalid("subjects must be a string or repeated string parameter") end
  if #items > 100 then invalid("subjects accepts at most 100 values") end
  local subjects, seen = { dids = {}, uris = {} }, {}
  for index, item in ipairs(items) do
    local is_did = valid_did(item)
    local valid_uri, collection
    if not is_did then valid_uri, collection = valid_record_uri(item) end
    if not is_did and (not valid_uri or not valid_badge_subject_nsid(collection)) then
      invalid("subjects[" .. index .. "] must be a valid DID or full record AT-URI with a valid collection NSID")
    end
    if not seen[item] then
      seen[item] = true
      if is_did then subjects.dids[#subjects.dids + 1] = item
      else subjects.uris[#subjects.uris + 1] = item end
    end
  end
  return subjects
end

local function add_filter(where, values, column, items)
  if not items then return end
  if #items == 0 then where[#where + 1] = "FALSE"; return end
  local placeholders = {}
  for _, item in ipairs(items) do
    values[#values + 1] = item
    placeholders[#placeholders + 1] = "$" .. #values
  end
  where[#where + 1] = column .. " IN (" .. table.concat(placeholders, ",") .. ")"
end

local function add_subject_filter(where, values, subjects)
  if not subjects then return end
  local clauses = {}
  if #subjects.dids > 0 then
    local placeholders = {}
    for _, did in ipairs(subjects.dids) do
      values[#values + 1] = did
      placeholders[#placeholders + 1] = "$" .. #values
    end
    clauses[#clauses + 1] = "(jsonb_typeof(award.record::jsonb->'subject') = 'string' AND " ..
      "award.record::jsonb->>'subject' IN (" .. table.concat(placeholders, ",") .. "))"
  end
  if #subjects.uris > 0 then
    local placeholders = {}
    for _, uri in ipairs(subjects.uris) do
      values[#values + 1] = uri
      placeholders[#placeholders + 1] = "$" .. #values
    end
    clauses[#clauses + 1] = "(jsonb_typeof(award.record::jsonb->'subject') = 'object' AND " ..
      "award.record::jsonb->'subject'->>'uri' IN (" .. table.concat(placeholders, ",") .. "))"
  end
  if #clauses == 0 then where[#where + 1] = "FALSE"
  else where[#where + 1] = "(" .. table.concat(clauses, " OR ") .. ")" end
end

local function decode_badge_award_cursor(token, direction)
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
  if not valid_datetime(value.t) or not valid_badge_award_uri(value.u) then invalid("cursor is malformed") end
  return value
end

local function award_sort_expression()
  local created = "award.record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(award.record::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. zoned .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE " ..
    "COALESCE(award.indexed_at::timestamptz, award.created_at::timestamptz) END"
end

local function recipient_did_expression()
  local subject = "award.record::jsonb->'subject'"
  return "CASE WHEN jsonb_typeof(" .. subject .. ") = 'string' THEN award.record::jsonb->>'subject' " ..
    "ELSE split_part(" .. subject .. "->>'uri', '/', 3) END"
end

local function badge_award_view(row)
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
  return view
end

local function list_badge_awards(authors, badge_uris, badge_types, subjects, responses, limit, cursor, direction)
  local where, values = { "award.collection = $1" }, { AWARD }
  add_filter(where, values, "award.did", authors)
  if badge_uris then
    local uri_expression = "award.record::jsonb->'badge'->>'uri'"
    add_filter(where, values, uri_expression, badge_uris)
  end
  add_subject_filter(where, values, subjects)
  if badge_types then add_filter(where, values, "badge.record::jsonb->>'badgeType'", badge_types) end
  if responses then
    if #responses == 0 then where[#where + 1] = "FALSE"
    else
      local placeholders = {}
      for _, status in ipairs(responses) do
        values[#values + 1] = status
        placeholders[#placeholders + 1] = "$" .. #values
      end
      where[#where + 1] = "COALESCE(recipient_response.record::jsonb->>'response', 'unanswered') IN (" ..
        table.concat(placeholders, ",") .. ")"
    end
  end
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, award.uri) " .. operator ..
      " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end
  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sql = "SELECT award.uri, award.did, award.cid, award.indexed_at::text AS indexed_at, " ..
    "award.record::text AS record, to_char(sorted.sort_at AT TIME ZONE 'UTC', " ..
    "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp, " ..
    "badge.uri AS badge_uri, badge.cid AS badge_cid, badge.indexed_at::text AS badge_indexed_at, " ..
    "badge.did AS badge_did, badge.record::text AS badge_record, " ..
    "recipient_response.uri AS recipient_response_uri, recipient_response.cid AS recipient_response_cid, " ..
    "recipient_response.indexed_at::text AS recipient_response_indexed_at, " ..
    "recipient_response.did AS recipient_response_did, recipient_response.record::text AS recipient_response_record " ..
    "FROM happyview_records AS award CROSS JOIN LATERAL (SELECT " .. award_sort_expression() .. " AS sort_at) sorted " ..
    "LEFT JOIN happyview_records AS badge ON badge.collection = '" .. DEFINITION .. "' " ..
    "AND badge.uri = award.record::jsonb->'badge'->>'uri' " ..
    "AND badge.cid = award.record::jsonb->'badge'->>'cid' " ..
    "LEFT JOIN LATERAL (SELECT response.uri, response.cid, response.indexed_at, response.did, response.record " ..
    "FROM happyview_records AS response WHERE response.collection = '" .. RESPONSE .. "' " ..
    "AND response.did = " .. recipient_did_expression() .. " " ..
    "AND response.record::jsonb->'badgeAward'->>'uri' = award.uri " ..
    "AND response.record::jsonb->'badgeAward'->>'cid' = award.cid " ..
    "AND response.record::jsonb->>'response' IN ('accepted', 'rejected') " ..
    "ORDER BY response.indexed_at DESC NULLS LAST, response.uri DESC LIMIT 1) AS recipient_response ON TRUE " ..
    "WHERE " .. table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering ..
    ", award.uri " .. ordering .. " LIMIT $" .. #values
  local rows = query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end
  local views, author_views = {}, {}
  for _, row in ipairs(rows) do
    local view = badge_award_view(row)
    views[#views + 1] = view
    author_views[#author_views + 1] = view.author
  end
  hydrate_actor_views(author_views, query)
  for _, author in ipairs(author_views) do
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

local function handle_list_badge_awards()
  keys_only(params, {
    authors = true, badgeUris = true, badgeTypes = true, subjects = true, responses = true,
    sortDirection = true, limit = true, cursor = true,
  })
  local authors = array_values("authors", valid_did, "valid DIDs")
  local badge_uris = array_values("badgeUris", valid_badge_definition_uri, "badge-definition AT-URIs")
  local badge_types = array_values("badgeTypes", nil, nil, 100)
  local subjects = subject_values()
  local responses = array_values("responses", function(value) return RESPONSE_STATUSES[value] == true end,
    "accepted, rejected, or unanswered statuses")
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = decode_badge_award_cursor(scalar(params, "cursor"), direction)
  local views, next_cursor = list_badge_awards(authors, badge_uris, badge_types, subjects, responses, limit, cursor, direction)
  local response = { badgeAwards = toarray(views) }
  if next_cursor then response.cursor = next_cursor end
  return response
end

function handle()
  return handle_list_badge_awards()
end
