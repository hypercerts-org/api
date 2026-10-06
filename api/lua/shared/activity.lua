local ACTIVITY = "org.hypercerts.claim.activity"

local function query(sql, values)
  if db.backend() ~= "postgres" then error("ActivityQueryFailed: activity API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ActivityQueryFailed: activity lookup failed", 0)
  end
  return result
end

local function activity_view(row)
  return activity_projection_view(row)
end

local function hydrate_activity_views(views)
  return activity_projection_hydrate_views(views)
end
