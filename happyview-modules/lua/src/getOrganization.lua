function handle()
  keys_only(params, { actor = true })
  local actor = scalar(params, "actor")
  if not actor or not valid_did(actor) then invalid("actor must be a valid DID") end

  local result = lookup_actors({ actor }, query)[1]
  if result.organization == NULL then error("RecordNotFound: organization sidecar is not indexed", 0) end
  return { actor = result }
end
