local function entity_follow_valid_nsid(value)
  if type(value) ~= "string" or #value > 317 then return false end
  local segments = {}
  for segment in value:gmatch("[^%.]+") do segments[#segments + 1] = segment end
  if #segments < 3 or table.concat(segments, ".") ~= value then return false end

  for _, segment in ipairs(segments) do
    if #segment > 63 or segment:find("[^A-Za-z0-9%-]")
      or segment:sub(1, 1) == "-" or segment:sub(-1) == "-" then
      return false
    end
  end

  if not segments[1]:sub(1, 1):match("^[A-Za-z]$") then return false end
  return segments[#segments]:match("^[A-Za-z][A-Za-z0-9]*$") ~= nil
end

-- An entity-follow target: a full DID-authority AT-URI with a valid collection NSID.
local function valid_entity_follow_uri(value)
  if #value > 8192 then return false end
  local valid, collection = valid_record_uri(value)
  return valid and entity_follow_valid_nsid(collection)
end
