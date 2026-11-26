local function actor_query(sql, values)
  if db.backend() ~= "postgres" then error("ActorQueryFailed: actor API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ActorQueryFailed: indexed actor lookup failed", 0)
  end
  return result
end

-- run_query defaults to the actor API's own error mapping; the organization
-- endpoints pass theirs so their documented OrganizationQueryFailed is kept.
local function lookup_actors(dids, run_query)
  run_query = run_query or actor_query
  local actors = {}
  for index, did in ipairs(dids) do
    actors[index] = { did = did, location = NULL }
  end
  hydrate_actor_views(actors, run_query)
  hydrate_actor_locations(actors, run_query)
  return actors
end
