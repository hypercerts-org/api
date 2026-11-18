-- Adds `column IN ($n, ...)` to where, binding items; an empty list matches nothing.
local function add_in(where, binds, column, items)
  if #items == 0 then
    where[#where + 1] = "FALSE"
    return
  end
  local marks = {}
  for _, item in ipairs(items) do
    binds[#binds + 1] = item
    marks[#marks + 1] = "$" .. #binds
  end
  where[#where + 1] = column .. " IN (" .. table.concat(marks, ", ") .. ")"
end
