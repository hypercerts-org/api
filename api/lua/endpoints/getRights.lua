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

local function rights_valid_did(value)
  if type(value) ~= "string" or not valid_did(value) then return false end
  local position = 1
  while true do
    local percent = value:find("%", position, true)
    if not percent then return true end
    local first = value:sub(percent + 1, percent + 1)
    local second = value:sub(percent + 2, percent + 2)
    if not first:match("^[0-9A-Fa-f]$") or not second:match("^[0-9A-Fa-f]$") then return false end
    position = percent + 3
  end
end

local function rights_valid_record_uri(value)
  local valid, collection = valid_record_uri(value)
  if not valid then return false end
  local authority = value:match("^at://([^/]+)/")
  return rights_valid_did(authority), collection
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

local RIGHTS_NULL = json.decode("null")

local function rights_record_view(row)
  local view = record_view(row)
  if row.indexed_at == nil then view.indexedAt = RIGHTS_NULL end
  return view
end

local function rights_hydrate_actor_views(actors, run_query)
  hydrate_actor_views(actors, run_query)
  for _, actor in ipairs(actors) do
    for _, sidecar in ipairs({ actor.profile, actor.organization }) do
      if type(sidecar) == "table" and sidecar.uri ~= nil and sidecar.indexedAt == nil then
        sidecar.indexedAt = RIGHTS_NULL
      end
    end
  end
end

local RIGHTS = "org.hypercerts.claim.rights"

local function rights_query(sql, values)
  if db.backend() ~= "postgres" then error("RightsQueryFailed: rights API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("RightsQueryFailed: rights lookup failed", 0)
  end
  return result
end

function handle()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  local valid, collection = rights_valid_record_uri(uri)
  if not uri or not valid or collection ~= RIGHTS then
    invalid("uri must be a full org.hypercerts.claim.rights AT-URI with a DID authority")
  end

  local rows = rights_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { RIGHTS, uri })
  if #rows == 0 then error("RecordNotFound: rights record is not indexed", 0) end

  local view = rights_record_view(rows[1])
  view.author = { did = view.did }
  rights_hydrate_actor_views({ view.author }, rights_query)
  return { rights = view }
end
