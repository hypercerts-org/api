local function requested_actor_dids(params, validate_did)
  local value = params.actors
  if value == nil then invalid("actors is required") end

  local actors = {}
  if type(value) == "string" or type(value) == "number" then
    actors[1] = scalar(params, "actors")
  elseif type(value) == "table" then
    local occurrences = 0
    for index in pairs(value) do
      if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
        invalid("actors must use repeated query values")
      end
      occurrences = occurrences + 1
    end
    if occurrences ~= #value then invalid("actors must use repeated query values") end
    for index = 1, occurrences do
      if type(value[index]) ~= "string" then invalid("actors entries must be strings") end
      actors[#actors + 1] = value[index]
    end
  else
    invalid("actors must be a string or repeated string parameter")
  end

  if #actors < 1 or #actors > 100 then invalid("actors must contain 1 through 100 DIDs") end

  local unique, seen = {}, {}
  for _, did in ipairs(actors) do
    if not validate_did(did) then invalid("each actors value must be a valid DID") end
    if not seen[did] then
      seen[did] = true
      unique[#unique + 1] = did
    end
  end
  return actors, unique
end
