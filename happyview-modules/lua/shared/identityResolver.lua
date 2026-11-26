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
