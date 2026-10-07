local function invalid(message)
  error("InvalidRequest: " .. message, 0)
end

local function keys_only(values, allowed, unknown_message_prefix)
  for key in pairs(values) do
    if not allowed[key] then
      invalid(unknown_message_prefix and (unknown_message_prefix .. key) or "unknown query parameter")
    end
  end
end

local function scalar(params, key)
  local value = params[key]
  if value == nil then return nil end
  if type(value) ~= "string" and type(value) ~= "number" then
    invalid(key .. " must occur once")
  end
  return tostring(value)
end

local function valid_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
end

local function valid_record_key(value)
  return #value >= 1 and #value <= 512 and value ~= "." and value ~= ".."
    and not value:find("[^%w_~%.:%-]")
end

local function valid_record_uri(value)
  if type(value) ~= "string" or value:find("[?#]") then return false end
  local authority, collection, rkey = value:match("^at://([^/]+)/([^/]+)/([^/]+)$")
  if not authority or not valid_did(authority) or not valid_record_key(rkey) then return false end
  return true, collection, authority
end

local NULL = json.decode("null")

local function record_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and NULL or row.indexed_at,
    did = row.did,
    record = json.decode(row.record),
  }
end

local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"

local function hydrate_actor_views(actors, run_query)
  if #actors == 0 then return end
  local dids, seen = {}, {}
  for _, actor in ipairs(actors) do
    if not seen[actor.did] then
      seen[actor.did] = true
      dids[#dids + 1] = actor.did
    end
  end
  local profiles, organizations = {}, {}
  local function load(collection, target)
    local params, marks = { collection }, {}
    for _, did in ipairs(dids) do
      params[#params + 1] = did
      marks[#marks + 1] = "$" .. #params
    end
    local rows = run_query("SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(marks, ",") .. ")", params)
    for _, row in ipairs(rows) do target[row.did] = row end
  end
  load(PROFILE, profiles)
  load(ORGANIZATION, organizations)
  for _, actor in ipairs(actors) do
    actor.profile = profiles[actor.did] and record_view(profiles[actor.did]) or NULL
    actor.organization = organizations[actor.did] and record_view(organizations[actor.did]) or NULL
  end
end

local MEASUREMENT = "org.hypercerts.context.measurement"
local MEASUREMENT_NULL = json.decode("null")

local function measurement_valid_record_uri(value)
  return valid_record_uri(value)
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

function handle()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  local valid, collection = measurement_valid_record_uri(uri)
  if not uri or not valid or collection ~= MEASUREMENT then
    invalid("uri must be a full " .. MEASUREMENT .. " AT-URI with a DID authority")
  end

  local rows = measurement_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { MEASUREMENT, uri })
  if #rows == 0 then error("RecordNotFound: measurement record is not indexed", 0) end

  local view = measurement_view(rows[1])
  hydrate_measurement_views({ view })
  return { measurement = view }
end
