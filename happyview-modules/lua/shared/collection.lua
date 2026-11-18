local COLLECTION = "org.hypercerts.collection"

local function collection_valid_record_uri(value)
  if type(value) ~= "string" or #value > 8192 then return false end
  return valid_record_uri(value)
end

local function collection_query(sql, values)
  if db.backend() ~= "postgres" then
    error("CollectionQueryFailed: collection API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("CollectionQueryFailed: collection lookup failed", 0)
  end
  return result
end

local function collection_view(row)
  return collection_projection_view(row)
end

local function collection_hydrate(views, omit_invalid)
  return collection_projection_hydrate(views, omit_invalid)
end
