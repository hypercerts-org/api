local EVMLINK_COLLECTION = "app.certified.link.evm"

local function valid_evm_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  if not valid_did(value) then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific then return false end

  local segment_length, index = 0, 1
  while index <= #specific do
    local char = specific:sub(index, index)
    if char == ":" then
      if segment_length == 0 then return false end
      segment_length = 0
      index = index + 1
    elseif char == "%" then
      local escape = specific:sub(index + 1, index + 2)
      if #escape ~= 2 or escape:find("[^%x]") then return false end
      segment_length = segment_length + 1
      index = index + 3
    elseif char:match("^[%w._%-]$") then
      segment_length = segment_length + 1
      index = index + 1
    else
      return false
    end
  end
  return segment_length > 0
end

local function valid_evm_link_uri(value)
  if type(value) ~= "string" or value:find("[?#]") then return false end
  local valid, collection = valid_record_uri(value)
  if not valid or collection ~= EVMLINK_COLLECTION then return false end
  local authority = value:match("^at://([^/]+)/")
  return valid_evm_did(authority)
end

local function evm_link_record_view(row)
  local view = record_view(row)
  if view.indexedAt == nil then view.indexedAt = NULL end
  return view
end

local function normalize_evm_actor_indexed_at(actors)
  for _, actor in ipairs(actors) do
    for _, field in ipairs({ "profile", "organization" }) do
      local sidecar = actor[field]
      if sidecar ~= nil and sidecar ~= NULL and sidecar.indexedAt == nil then
        sidecar.indexedAt = NULL
      end
    end
  end
end
