function handle()
  keys_only(params, { actors = true })
  local dids, unique = requested_actor_dids(params, valid_lookup_did)
  local by_did = {}
  for _, actor in ipairs(lookup_actors(unique)) do by_did[actor.did] = actor end

  local actors = {}
  for index, did in ipairs(dids) do actors[index] = by_did[did] end
  return { actors = toarray(actors) }
end
