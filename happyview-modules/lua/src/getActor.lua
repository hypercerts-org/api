function handle()
  keys_only(params, { actor = true })
  local did = scalar(params, "actor")
  if not valid_did(did) then invalid("actor must be a valid DID") end

  return { actor = lookup_actors({ did })[1] }
end
