function handle()
  keys_only(params, { actor = true })
  local did = scalar(params, "actor")
  if not valid_did(did) then invalid("actor must be a valid DID") end

  local actor = lookup_actors({ did })[1]
  hydrate_actor_handle(actor)
  return { actor = actor }
end
