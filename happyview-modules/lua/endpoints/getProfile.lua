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

local function query(sql, values)
  if db.backend() ~= "postgres" then error("ProfileQueryFailed: profile API requires PostgreSQL", 0) end
  local ok, result = pcall(db.raw, sql, values)
  if not ok then error("ProfileQueryFailed: profile lookup failed", 0) end
  return result
end

local function valid_handle(value)
  if type(value) ~= "string" or #value > 253 or value:find("[^%w%.%-]")
    or value:find("%.%.") or value:sub(1, 1) == "." or value:sub(-1) == "." then
    return false
  end
  local labels = 0
  for label in value:gmatch("[^%.]+") do
    labels = labels + 1
    if #label > 63 or label:sub(1, 1) == "-" or label:sub(-1) == "-" then return false end
  end
  return labels >= 2
end

local function encode_query_value(value)
  return (value:gsub("([^%w%.%-_~])", function(char)
    return string.format("%%%02X", string.byte(char))
  end))
end

local function fetch_resolver_json(url)
  local ok, response = pcall(http.get, url)
  if not ok or type(response) ~= "table" or type(response.status) ~= "number"
    or response.status < 200 or response.status >= 300 or type(response.body) ~= "string" then
    return nil
  end
  local decoded, value = pcall(json.decode, response.body)
  if not decoded or type(value) ~= "table" then return nil end
  return value
end

local DEFAULT_RESOLVER_URL = "https://slingshot.microcosm.blue"

local function resolver_base_url()
  local configured = type(env) == "table" and env.HYPERCERTS_HANDLE_RESOLVER_URL or nil
  -- Only an absent setting selects the default; a present but invalid value must still fail.
  if configured == nil then return DEFAULT_RESOLVER_URL end
  if type(configured) ~= "string" or #configured > 2048
    or configured:find("[%c%s]") or configured:find("\\", 1, true) or configured:find("%", 1, true) then
    return nil
  end

  local scheme, authority, suffix = configured:match("^([%a]+)://([^/?#]+)(.*)$")
  if not scheme or scheme:lower() ~= "https" or (suffix ~= "" and suffix ~= "/")
    or authority:find("@", 1, true) then
    return nil
  end
  return "https://" .. authority
end

local function fail_resolution()
  error("HandleResolutionFailed: handle could not be resolved", 0)
end

local function fail_resolver_config()
  error("HandleResolverConfigError: HYPERCERTS_HANDLE_RESOLVER_URL must be an HTTPS resolver base URL with no credentials, path, query, or fragment; fix or remove this HappyView script variable (unset uses the default resolver)", 0)
end

local function resolve_handle(handle)
  local base = resolver_base_url()
  if not base then fail_resolver_config() end
  local url = base .. "/xrpc/com.atproto.identity.resolveHandle?handle=" .. encode_query_value(handle)
  local resolved = fetch_resolver_json(url)
  if not resolved or not valid_did(resolved.did) then fail_resolution() end
  return resolved.did
end

local function get_profile()
  keys_only(params, { actor = true })
  local actor = scalar(params, "actor")
  if not actor then invalid("actor must be a DID or handle") end

  local did
  if actor:sub(1, 4) == "did:" then
    if not valid_did(actor) then invalid("actor must be a valid DID or handle") end
    did = actor
  else
    local handle = actor:lower()
    if not valid_handle(handle) then invalid("actor must be a valid DID or handle") end
    did = resolve_handle(handle)
  end

  local rows = query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record FROM happyview_records WHERE collection = $1 AND did = $2 AND rkey = 'self' LIMIT 1",
    { PROFILE, did })
  if #rows == 0 then error("RecordNotFound: profile is not indexed", 0) end
  return { profile = record_view(rows[1]) }
end

function handle()
  return get_profile()
end
