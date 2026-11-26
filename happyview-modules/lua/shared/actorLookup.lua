local function actor_query(sql, values)
  if db.backend() ~= "postgres" then error("ActorQueryFailed: actor API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ActorQueryFailed: indexed actor lookup failed", 0)
  end
  return result
end

local function lookup_actors(dids)
  local actors = {}
  for index, did in ipairs(dids) do
    actors[index] = { did = did, location = NULL }
  end
  hydrate_actor_views(actors, actor_query)
  hydrate_actor_locations(actors, actor_query)
  return actors
end
