local CONTRIBUTOR_INFORMATION_COLLECTION = "org.hypercerts.claim.contributorInformation"

local function contributor_information_uri(value)
  local valid, collection, authority = valid_record_uri(value)
  if not valid or collection ~= CONTRIBUTOR_INFORMATION_COLLECTION then return false end
  return valid_did(authority)
end
