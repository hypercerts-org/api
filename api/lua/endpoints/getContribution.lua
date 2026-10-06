local function valid_did(value)
  if type(value) ~= "string" or #value > 2048 then return false end
  local method, specific = value:match("^did:([a-z]+):(.+)$")
  if not method or not specific or specific:sub(-1) == ":" or specific:sub(-1) == "%"
    or value:find("[^%w%.:_%%%-]") then return false end
  return true
end

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

local CONTRIBUTION = "org.hypercerts.claim.contribution"

local function valid_contribution_did(value)
  if type(value) ~= "string" or not valid_did(value) then return false end
  local index = 1
  while index <= #value do
    if value:sub(index, index) == "%" then
      local escape = value:sub(index + 1, index + 2)
      if #escape ~= 2 or escape:find("[^0-9A-Fa-f]") then return false end
      index = index + 3
    else
      index = index + 1
    end
  end
  return true
end

local function valid_contribution_uri(value)
  local valid, collection, authority = valid_record_uri(value)
  if not valid or collection ~= CONTRIBUTION then return false end
  return valid_contribution_did(authority)
end

local function contribution_query(sql, values)
  if db.backend() ~= "postgres" then
    error("ContributionQueryFailed: contribution API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("ContributionQueryFailed: indexed contribution lookup failed", 0)
  end
  return result
end

local function contribution_view(row)
  local view = record_view(row)
  local author = { did = view.did }
  hydrate_actor_views({ author }, contribution_query)
  view.author = author
  return view
end

function handle()
  keys_only(params, { uri = true })
  local uri = scalar(params, "uri")
  if not valid_contribution_uri(uri) then
    invalid("uri must be a full org.hypercerts.claim.contribution AT-URI with a DID authority")
  end

  local rows = contribution_query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record " ..
      "FROM happyview_records WHERE collection = $1 AND uri = $2 LIMIT 1",
    { CONTRIBUTION, uri })
  if #rows == 0 then error("RecordNotFound: contribution record is not indexed", 0) end

  return { contribution = contribution_view(rows[1]) }
end
