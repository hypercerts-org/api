-- Decodes a hex-encoded {v, d, t, u} list cursor. Rejects malformed tokens, other
-- sort directions and unknown keys; validate_value(value) -> boolean runs the
-- endpoint-specific check on t and u. Not for endpoints that skip the 8192-character
-- cap or accept extra keys.
local function decode_cursor(token, direction, validate_value)
  if token == nil then return nil end
  if #token == 0 or #token > 8192 or #token % 2 ~= 0 or token:find("[^0-9a-f]") then
    invalid("cursor is malformed")
  end
  local decoded = token:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end)
  local ok, value = pcall(json.decode, decoded)
  if not ok or type(value) ~= "table" or value.v ~= 1 or value.d ~= direction
    or type(value.t) ~= "string" or type(value.u) ~= "string" then
    invalid("cursor is malformed or belongs to another sortDirection")
  end
  for key in pairs(value) do
    if key ~= "v" and key ~= "d" and key ~= "t" and key ~= "u" then invalid("cursor is malformed") end
  end
  if not validate_value(value) then invalid("cursor is malformed") end
  return value
end
