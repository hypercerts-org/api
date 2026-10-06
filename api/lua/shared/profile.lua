local PROFILE = "app.certified.actor.profile"
local NULL = json.decode("null")

local function query(sql, values)
  if db.backend() ~= "postgres" then error("ProfileQueryFailed: profile API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("ProfileQueryFailed: profile lookup failed", 0) end
  return result
end

local function row_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and NULL or row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end
