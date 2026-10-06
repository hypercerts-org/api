local MEASUREMENT = "org.hypercerts.context.measurement"
local MEASUREMENT_NULL = json.decode("null")

local function measurement_valid_did(value)
  if not valid_did(value) then return false end
  local position = 1
  while true do
    local percent = value:find("%", position, true)
    if not percent then return true end
    local hex = value:sub(percent + 1, percent + 2)
    if #hex ~= 2 or hex:find("[^0-9A-Fa-f]") then return false end
    position = percent + 3
  end
end

local function measurement_valid_record_uri(value)
  local valid, collection, authority = valid_record_uri(value)
  if not valid then return false end
  return measurement_valid_did(authority), collection
end

local function measurement_query(sql, values)
  if db.backend() ~= "postgres" then
    error("MeasurementQueryFailed: measurement queries require PostgreSQL", 0)
  end
  local rows = db.raw(sql, values)
  if type(rows) ~= "table" then
    error("MeasurementQueryFailed: database returned an invalid result", 0)
  end
  return rows
end

local function measurement_view(row)
  local view = record_view(row)
  if row.indexed_at == nil then view.indexedAt = MEASUREMENT_NULL end
  view.author = { did = row.did }
  return view
end

local function omit_null_sidecar_indexed_at(sidecar)
  if type(sidecar) == "table" and sidecar.indexedAt == MEASUREMENT_NULL then
    sidecar.indexedAt = nil
  end
end

local function hydrate_measurement_views(views)
  local authors = {}
  for _, view in ipairs(views) do authors[#authors + 1] = view.author end
  hydrate_actor_views(authors, measurement_query)
  -- Measurement sidecars historically omitted SQL-NULL timestamps; top-level views retain JSON null.
  for _, author in ipairs(authors) do
    omit_null_sidecar_indexed_at(author.profile)
    omit_null_sidecar_indexed_at(author.organization)
  end
end
