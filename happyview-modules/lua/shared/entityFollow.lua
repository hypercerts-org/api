local ENTITY_FOLLOW = "app.certified.graph.entityFollow"
local ENTITY_FOLLOW_NULL = json.decode("null")

local function entity_follow_query(sql, values)
  if db.backend() ~= "postgres" then
    error("EntityFollowQueryFailed: entity-follow queries require PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("EntityFollowQueryFailed: entity-follow lookup failed", 0)
  end
  return result
end

local function entity_follow_typed_view(row)
  local view = record_view(row)
  view["$type"] = "app.certified.graph.getEntityFollow#entityFollowRecordView"
  return view
end
