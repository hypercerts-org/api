local CONTRIBUTION = "org.hypercerts.claim.contribution"

local function valid_contribution_did(value)
  if type(value) ~= "string" or not valid_did(value) then return false end
  local index = 1
  while index <= #value do
    if value:sub(index, index) == "%" then
      local escape = value:sub(index + 1, index + 2)
      if #escape ~= 2 or escape:find("[^0-9A-Fa-f]") then return false end
      index = index + 3
    else
      index = index + 1
    end
  end
  return true
end

local function valid_contribution_uri(value)
  local valid, collection, authority = valid_record_uri(value)
  if not valid or collection ~= CONTRIBUTION then return false end
  return valid_contribution_did(authority)
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
