-- Reads a repeated query parameter (?key=a&key=b) as a list of strings, or nil when absent.
-- A single value counts as a list of one. Rejects non-string entries, keyed or sparse
-- tables and more than 100 values. Item rules stay with the caller so each endpoint keeps
-- its own error messages; see unique_query_values.
local function query_string_values(params, key)
  local value = params[key]
  if value == nil then return nil end
  if type(value) == "string" then return { value } end
  if type(value) ~= "table" then
    invalid(key .. " must be a string or repeated string parameter")
  end
  local count = 0
  for index in pairs(value) do
    if type(index) ~= "number" or index < 1 or index % 1 ~= 0 then
      invalid(key .. " must use repeated query values")
    end
    count = count + 1
  end
  if count ~= #value then invalid(key .. " must use repeated query values") end
  local values = {}
  for index = 1, count do
    if type(value[index]) ~= "string" then invalid(key .. " entries must be strings") end
    values[index] = value[index]
  end
  if #values > 100 then invalid(key .. " accepts at most 100 values") end
  return values
end

-- Runs check(item, index) on every value in order, then returns the distinct results in
-- first-seen order. check raises its own error for a bad item and may return a normalized
-- replacement; returning nothing keeps the item.
local function unique_query_values(values, check)
  local unique, seen = {}, {}
  for index, item in ipairs(values) do
    local value = check and check(item, index) or item
    if not seen[value] then
      seen[value] = true
      unique[#unique + 1] = value
    end
  end
  return unique
end
