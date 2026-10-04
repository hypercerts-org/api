local function rights_valid_did(value)
  if type(value) ~= "string" or not valid_did(value) then return false end
  local position = 1
  while true do
    local percent = value:find("%", position, true)
    if not percent then return true end
    local first = value:sub(percent + 1, percent + 1)
    local second = value:sub(percent + 2, percent + 2)
    if not first:match("^[0-9A-Fa-f]$") or not second:match("^[0-9A-Fa-f]$") then return false end
    position = percent + 3
  end
end

local function rights_valid_record_uri(value)
  local valid, collection = valid_record_uri(value)
  if not valid then return false end
  local authority = value:match("^at://([^/]+)/")
  return rights_valid_did(authority), collection
end
