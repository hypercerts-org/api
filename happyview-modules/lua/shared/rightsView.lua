local RIGHTS_NULL = json.decode("null")

local function rights_record_view(row)
  local view = record_view(row)
  if row.indexed_at == nil then view.indexedAt = RIGHTS_NULL end
  return view
end

local function rights_hydrate_actor_views(actors, run_query)
  hydrate_actor_views(actors, run_query)
  for _, actor in ipairs(actors) do
    for _, sidecar in ipairs({ actor.profile, actor.organization }) do
      if type(sidecar) == "table" and sidecar.uri ~= nil and sidecar.indexedAt == nil then
        sidecar.indexedAt = RIGHTS_NULL
      end
    end
  end
end
