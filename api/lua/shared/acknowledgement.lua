local ACKNOWLEDGEMENT = "org.hypercerts.context.acknowledgement"
local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"
local NULL = json.decode("null")

local function invalid(message)
  error("InvalidRequest: " .. message, 0)
end

local function keys_only(values, allowed)
  for key in pairs(values) do
    if not allowed[key] then invalid("unknown query parameter") end
  end
end

local function scalar(values, key)
  local value = values[key]
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
  local position = 1
  while true do
    local percent = value:find("%", position, true)
    if not percent then break end
    local escape = value:sub(percent + 1, percent + 2)
    if #escape ~= 2 or escape:find("[^0-9A-Fa-f]") then return false end
    position = percent + 3
  end
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
  return true, collection
end

local function acknowledgement_query(sql, values)
  if db.backend() ~= "postgres" then
    error("AcknowledgementQueryFailed: acknowledgement API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("AcknowledgementQueryFailed: indexed record or publisher lookup failed", 0)
  end
  return result
end

local function acknowledgement_record_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at or NULL,
    did = row.did,
    record = json.decode(row.record),
  }
end

local function hydrate_acknowledgement_authors(views)
  local dids, seen = {}, {}
  for _, view in ipairs(views) do
    if not seen[view.did] then
      seen[view.did] = true
      dids[#dids + 1] = view.did
    end
  end
  if #dids == 0 then return end

  local profiles, organizations = {}, {}
  local function load(collection, target)
    local values, marks = { collection }, {}
    for _, did in ipairs(dids) do
      values[#values + 1] = did
      marks[#marks + 1] = "$" .. #values
    end
    local rows = acknowledgement_query(
      "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
        "FROM happyview_records WHERE collection = $1 AND rkey = 'self' AND did IN (" .. table.concat(marks, ",") .. ")",
      values)
    for _, row in ipairs(rows) do target[row.did] = row end
  end
  load(PROFILE, profiles)
  load(ORGANIZATION, organizations)
  for _, view in ipairs(views) do
    view.author = {
      did = view.did,
      profile = profiles[view.did] and acknowledgement_record_view(profiles[view.did]) or NULL,
      organization = organizations[view.did] and acknowledgement_record_view(organizations[view.did]) or NULL,
    }
  end
end
