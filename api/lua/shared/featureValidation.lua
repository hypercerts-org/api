local FEATURE_COLLECTION = "org.hypercerts.entity.feature"

local function feature_valid_did(value)
  if not valid_did(value) then return false end
  local position = 1
  while true do
    local escape_start = value:find("%", position, true)
    if not escape_start then return true end
    local escape = value:sub(escape_start + 1, escape_start + 2)
    if not escape:match("^[0-9a-fA-F][0-9a-fA-F]$") then return false end
    position = escape_start + 3
  end
end

local function feature_valid_uri(value)
  if type(value) ~= "string" or #value > 8192 then return false end
  local valid, collection, authority = valid_record_uri(value)
  if not valid or collection ~= FEATURE_COLLECTION then return false end
  return feature_valid_did(authority)
end
