local CONTRIBUTOR_INFORMATION_COLLECTION = "org.hypercerts.claim.contributorInformation"

local function contributor_information_did(value)
  if not valid_did(value) then return false end
  local position = 1
  while true do
    local percent = value:find("%", position, true)
    if not percent then return true end
    local escape = value:sub(percent + 1, percent + 2)
    if #escape ~= 2 or escape:find("[^%x]") then return false end
    position = percent + 3
  end
end

local function contributor_information_uri(value)
  local valid, collection, authority = valid_record_uri(value)
  if not valid or collection ~= CONTRIBUTOR_INFORMATION_COLLECTION then return false end
  return contributor_information_did(authority)
end
