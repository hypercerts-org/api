local function parse_include_total(values)
  local value = values.includeTotal
  if value == nil then return false end
  if type(value) == "boolean" then return value end
  value = scalar(values, "includeTotal")
  if value == "true" then return true end
  if value == "false" then return false end
  invalid("includeTotal must be true or false")
end
