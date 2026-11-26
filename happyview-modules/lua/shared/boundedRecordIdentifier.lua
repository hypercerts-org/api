-- For user-supplied filter values: bounds the size before parsing.
local function valid_bounded_record_uri(value)
  if type(value) ~= "string" or #value > 8192 then return false end
  return valid_record_uri(value)
end
