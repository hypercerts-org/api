-- Appends each item to binds and returns its "$n" placeholders, in order.
local function bind_values(binds, items)
  local placeholders = {}
  for _, item in ipairs(items) do
    binds[#binds + 1] = item
    placeholders[#placeholders + 1] = "$" .. #binds
  end
  return placeholders
end

-- Adds `column IN ($n, ...)` to where, binding items; an empty list matches nothing.
local function add_in(where, binds, column, items)
  if #items == 0 then
    where[#where + 1] = "FALSE"
    return
  end
  where[#where + 1] = column .. " IN (" .. table.concat(bind_values(binds, items), ", ") .. ")"
end
