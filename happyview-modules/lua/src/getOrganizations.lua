function handle()
  keys_only(params, { actors = true })
  local actors, unique = requested_actor_dids(params, valid_did)

  local values, placeholders = { ORGANIZATION }, {}
  for _, did in ipairs(unique) do
    values[#values + 1] = did
    placeholders[#placeholders + 1] = "$" .. #values
  end
  local rows = query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(placeholders, ", ") .. ")",
    values)

  local organizations_by_did, organization_actors = {}, {}
  for _, row in ipairs(rows) do
    local actor = organization_actor_view(row)
    organizations_by_did[row.did] = actor
    organization_actors[#organization_actors + 1] = actor
  end
  hydrate_organization_actors(organization_actors)

  local organizations = {}
  for _, did in ipairs(actors) do
    organizations[#organizations + 1] = {
      actor = did,
      organization = organizations_by_did[did] or NULL,
    }
  end
  return { organizations = toarray(organizations) }
end
