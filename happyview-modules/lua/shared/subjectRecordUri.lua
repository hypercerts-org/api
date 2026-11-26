-- A record subject: a full DID-authority AT-URI with a valid collection NSID.
local function valid_subject_record_uri(value)
  if #value > 8192 then return false end
  local valid, collection = valid_record_uri(value)
  return valid and valid_nsid(collection)
end
