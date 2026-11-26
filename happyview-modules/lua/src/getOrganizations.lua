function handle()
  keys_only(params, { actors = true })
  local actors, unique = requested_actor_dids(params, valid_did)

  local by_did = {}
  for _, actor in ipairs(lookup_actors(unique, query)) do by_did[actor.did] = actor end

  local organizations = {}
  for _, did in ipairs(actors) do
    local actor = by_did[did]
    organizations[#organizations + 1] = {
      actor = did,
      organization = actor.organization ~= NULL and actor or NULL,
    }
  end
  return { organizations = toarray(organizations) }
end
