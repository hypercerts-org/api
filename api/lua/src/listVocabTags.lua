local COLLECTION = VOCAB_TAG

local function query(sql, values)
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("VocabTagQueryFailed: vocabulary tag or publisher query failed", 0) end
  return result
end

local function parse_authors(value)
  if value == nil then return nil end
  local supplied = {}
  if type(value) == "string" then
    supplied[1] = value
  elseif type(value) == "table" then
    local count = 0
    for key in pairs(value) do
      if type(key) ~= "number" or key < 1 or key % 1 ~= 0 then
        invalid("authors must be repeated string values")
      end
      count = count + 1
    end
    if count ~= #value then invalid("authors must be repeated string values") end
    for i = 1, #value do
      if type(value[i]) ~= "string" then invalid("authors entries must be strings") end
      supplied[#supplied + 1] = value[i]
    end
  else
    invalid("authors must be a string or repeated string parameter")
  end
  if #supplied > 100 then invalid("authors accepts at most 100 values") end

  local unique, seen = {}, {}
  for _, author in ipairs(supplied) do
    if not valid_vocab_did(author) then invalid("each authors value must be a valid DID") end
    if not seen[author] then
      seen[author] = true
      unique[#unique + 1] = author
    end
  end
  if #unique == 0 then return nil end
  table.sort(unique)
  return unique
end

local function add_authors_filter(where, values, authors)
  if not authors then return end
  local placeholders = {}
  for _, author in ipairs(authors) do
    values[#values + 1] = author
    placeholders[#placeholders + 1] = "$" .. #values
  end
  where[#where + 1] = "did IN (" .. table.concat(placeholders, ",") .. ")"
end

local function filter_signature(authors)
  return table.concat(authors or {}, ",")
end

local function decode_cursor(token, direction, authors)
  if not token then return nil end
  if #token % 2 ~= 0 or token:find("[^0-9a-f]") then invalid("cursor is malformed") end
  local decoded = token:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end)
  local ok, value = pcall(json.decode, decoded)
  if not ok or type(value) ~= "table" or value.v ~= 1 or value.d ~= direction
    or type(value.f) ~= "string" or value.f ~= filter_signature(authors)
    or type(value.t) ~= "string" or type(value.u) ~= "string" then
    invalid("cursor is malformed or belongs to different query parameters")
  end
  for key in pairs(value) do
    if key ~= "v" and key ~= "d" and key ~= "f" and key ~= "t" and key ~= "u" then
      invalid("cursor is malformed")
    end
  end
  if not valid_datetime(value.t) then invalid("cursor is malformed") end
  if value.t:sub(1, 4) == "0000" then invalid("cursor timestamp year must be greater than 0000") end
  if not valid_vocab_tag_uri(value.u) then invalid("cursor is malformed") end
  return value
end

local function sort_expression()
  local created = "record::jsonb->>'createdAt'"
  local zoned = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"
  return "CASE WHEN jsonb_typeof(record::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. zoned .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE COALESCE(indexed_at::timestamptz, created_at::timestamptz) END"
end

local function list_vocab_tags(authors, limit, cursor, direction)
  if db.backend() ~= "postgres" then
    error("VocabTagQueryFailed: vocabulary tag API requires PostgreSQL", 0)
  end

  local where, values = { "collection = $1" }, { COLLECTION }
  add_authors_filter(where, values, authors)
  if cursor then
    values[#values + 1] = cursor.t
    local timestamp = "$" .. #values
    values[#values + 1] = cursor.u
    local uri = "$" .. #values
    local operator = direction == "asc" and ">" or "<"
    where[#where + 1] = "(sorted.sort_at, uri) " .. operator .. " ((" .. timestamp .. ")::timestamptz, " .. uri .. ")"
  end

  values[#values + 1] = limit + 1
  local ordering = direction == "asc" and "ASC" or "DESC"
  local sort_at = sort_expression()
  local sql = "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record, " ..
    "to_char(sorted.sort_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS sort_timestamp " ..
    "FROM happyview_records CROSS JOIN LATERAL (SELECT " .. sort_at .. " AS sort_at) sorted WHERE " ..
    table.concat(where, " AND ") .. " ORDER BY sorted.sort_at " .. ordering .. ", uri " .. ordering ..
    " LIMIT $" .. #values
  local rows = query(sql, values)
  local more = #rows > limit
  if more then rows[#rows] = nil end

  local views, authors_to_hydrate = {}, {}
  for _, row in ipairs(rows) do
    local view = record_view(row)
    if row.indexed_at == nil then view.indexedAt = json.decode("null") end
    view.author = { did = view.did }
    views[#views + 1] = view
    authors_to_hydrate[#authors_to_hydrate + 1] = view.author
  end
  hydrate_vocab_actor_views(authors_to_hydrate, query)

  local next_cursor
  if more then
    local last = rows[#rows]
    next_cursor = cursor_encode({
      v = 1,
      d = direction,
      f = filter_signature(authors),
      t = last.sort_timestamp,
      u = last.uri,
    })
  end
  return views, next_cursor
end

local function handle_list_vocab_tags()
  keys_only(params, { authors = true, sortDirection = true, limit = true, cursor = true })
  local authors = parse_authors(params.authors)
  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = decode_cursor(scalar(params, "cursor"), direction, authors)
  local views, next_cursor = list_vocab_tags(authors, limit, cursor, direction)
  local response = { vocabTags = toarray(views) }
  if next_cursor then response.cursor = next_cursor end
  return response
end

function handle()
  return handle_list_vocab_tags()
end
