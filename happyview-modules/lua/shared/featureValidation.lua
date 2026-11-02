local FEATURE_COLLECTION = "org.hypercerts.entity.feature"

local function feature_valid_uri(value)
  if type(value) ~= "string" or #value > 8192 then return false end
  local valid, collection, authority = valid_record_uri(value)
  if not valid or collection ~= FEATURE_COLLECTION then return false end
  return valid_did(authority)
end
