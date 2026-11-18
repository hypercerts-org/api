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

local function feed_reaction_query(reaction, sql, values)
  if db.backend() ~= "postgres" then error(reaction.failure .. ": reaction queries require PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error(reaction.failure .. ": indexed reaction query failed", 0) end
  return result
end

local function feed_reaction_decode_cursor(token, direction, collection)
  return decode_cursor(token, direction, function(value)
    local valid, cursor_collection = valid_record_uri(value.u)
    return valid and cursor_collection == collection and valid_datetime(value.t)
  end)
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
  local sql = "WITH ranked_reactions AS (SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record, sorted.sort_at, ROW_NUMBER() OVER (PARTITION BY did, " .. subject_uri .. " ORDER BY sorted.sort_at ASC, uri ASC) AS relationship_rank FROM happyview_records CROSS JOIN LATERAL (SELECT " .. created_at_sort() .. " AS sort_at) sorted WHERE " .. table.concat(filters, " AND ") .. "), " ..
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
