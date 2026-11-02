local CONTRIBUTION = "org.hypercerts.claim.contribution"

local function valid_contribution_uri(value)
  local valid, collection, authority = valid_record_uri(value)
  if not valid or collection ~= CONTRIBUTION then return false end
  return valid_did(authority)
end

local function contribution_query(sql, values)
  if db.backend() ~= "postgres" then
    error("ContributionQueryFailed: contribution API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ContributionQueryFailed: indexed contribution lookup failed", 0)
  end
  return result
end

local function contribution_view(row)
  local view = record_view(row)
  local author = { did = view.did }
  hydrate_actor_views({ author }, contribution_query)
  view.author = author
  return view
end
