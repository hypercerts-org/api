local ACKNOWLEDGEMENT = "org.hypercerts.context.acknowledgement"
local PROFILE = "app.certified.actor.profile"
local ORGANIZATION = "app.certified.actor.organization"
local NULL = json.decode("null")

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
