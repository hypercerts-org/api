local function list_entity_following_page(actor, limit, cursor, direction)
  local candidates, subjects_by_row = {}, {}
  local scan_cursor = cursor
  local scan_limit = limit + 1

  while #candidates < limit + 1 do
    local batch, batch_cursor = entity_follow_query_page("following", actor, scan_limit, scan_cursor, direction)
    for _, row in ipairs(batch) do
      local uri, collection = entity_follow_subject_uri(row)
      if uri then
        candidates[#candidates + 1] = row
        subjects_by_row[row] = { uri = uri, collection = collection }
        if #candidates == limit + 1 then break end
      end
    end

    if #candidates == limit + 1 or not batch_cursor then break end
    scan_cursor = entity_follow_decode_cursor(batch_cursor, direction)
  end

  local rows = {}
  for index = 1, math.min(limit, #candidates) do rows[index] = candidates[index] end

  local next_cursor
  if #candidates > limit then
    local last = rows[#rows]
    if not last or type(last.sort_timestamp) ~= "string" or type(last.uri) ~= "string" then
      error("EntityFollowQueryFailed: next-page cursor fields unavailable", 0)
    end
    next_cursor = cursor_encode({ v = 1, d = direction, t = last.sort_timestamp, u = last.uri })
  end
  return rows, next_cursor, subjects_by_row
end

local function list_entity_following()
  keys_only(params, { actor = true, sortDirection = true, limit = true, cursor = true }, "unknown query parameter: ")
  local actor = scalar(params, "actor")
  if not actor or not valid_did(actor) then invalid("actor must be a valid DID") end

  local limit = parse_list_limit(params)
  local direction = parse_sort_direction(params)
  local cursor = entity_follow_decode_cursor(scalar(params, "cursor"), direction)
  local rows, next_cursor, subjects_by_row = list_entity_following_page(actor, limit, cursor, direction)
  local response = { entities = toarray(entity_follow_resolve_entities(rows, subjects_by_row)) }
  if next_cursor then response.cursor = next_cursor end
  return response
end

function handle()
  return list_entity_following()
end
