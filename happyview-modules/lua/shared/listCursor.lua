-- Decodes a hex-encoded {v, d, t, u} list cursor. Rejects malformed tokens, other
-- sort directions and unknown keys; validate_value(value) -> boolean runs the
-- endpoint-specific check on t and u. Not for endpoints that skip the 8192-character
-- cap or accept extra keys.
local function decode_cursor(token, direction, validate_value)
  if token == nil then return nil end
  local decoded = decode_hex_cursor_token(token)
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

-- decode_cursor for the common case: t is a datetime and u a record URI.
-- record_uri is the collection NSID u must belong to, or a predicate(uri) -> boolean
-- for endpoints with stricter URI rules. valid_t(t) defaults to valid_datetime.
local function decode_record_cursor(token, direction, record_uri, valid_t)
  valid_t = valid_t or valid_datetime
  return decode_cursor(token, direction, function(value)
    if not valid_t(value.t) then return false end
    if type(record_uri) == "function" then return record_uri(value.u) end
    local valid, collection = valid_record_uri(value.u)
    return valid and collection == record_uri
  end)
end
