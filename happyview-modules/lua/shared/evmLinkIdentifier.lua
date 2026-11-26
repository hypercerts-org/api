local EVMLINK_COLLECTION = "app.certified.link.evm"

local function valid_evm_link_uri(value)
  if type(value) ~= "string" or value:find("[?#]") then return false end
  local valid, collection = valid_record_uri(value)
  return valid and collection == EVMLINK_COLLECTION
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
