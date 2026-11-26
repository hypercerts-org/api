-- Like scalar(), but a boolean comes back as "true" or "false": HappyView can hand
-- boolean-typed query parameters to Lua as booleans rather than strings.
local function scalar_or_boolean(values, key)
  if type(values[key]) == "boolean" then return tostring(values[key]) end
  return scalar(values, key)
end
