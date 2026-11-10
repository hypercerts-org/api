-- valid_did allows "%" in a DID; the DID syntax requires two hex digits after it.
local function valid_did_percent_escapes(authority)
  local index = 1
  while index <= #authority do
    if authority:sub(index, index) == "%" then
      if not authority:sub(index + 1, index + 2):match("^%x%x$") then return false end
      index = index + 3
    else
      index = index + 1
    end
  end
  return true
end

-- A record subject: a full DID-authority AT-URI with a valid collection NSID.
local function valid_subject_record_uri(value)
  if #value > 8192 then return false end
  local valid, collection, authority = valid_record_uri(value)
  return valid and valid_did_percent_escapes(authority) and valid_nsid(collection)
end
