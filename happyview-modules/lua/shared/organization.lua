local function query(sql, values)
  if db.backend() ~= "postgres" then error("OrganizationQueryFailed: organization API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("OrganizationQueryFailed: organization lookup failed", 0)
  end
  return result
end
