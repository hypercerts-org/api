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

local function valid_port(value)
  local port = tonumber(value)
  return port and port >= 1 and port <= 65535
end

local function valid_ipv4(value)
  if value:sub(1, 1) == "." or value:sub(-1) == "." or value:find("..", 1, true) then return false end
  local count = 0
  for octet in value:gmatch("[^%.]+") do
    local number = tonumber(octet)
    if not octet:match("^%d+$") or #octet > 3 or (#octet > 1 and octet:sub(1, 1) == "0")
      or not number or number > 255 then return false end
    count = count + 1
  end
  return count == 4
end

local function ipv6_group_count(part)
  if part == "" then return 0 end
  if part:sub(1, 1) == ":" or part:sub(-1) == ":" or part:find("::", 1, true) then return nil end
  local groups, count = {}, 0
  for group in part:gmatch("[^:]+") do groups[#groups + 1] = group end
  for index, group in ipairs(groups) do
    if group:find(".", 1, true) then
      if index ~= #groups or not valid_ipv4(group) then return nil end
      count = count + 2
    else
      if #group > 4 or not group:match("^%x+$") then return nil end
      count = count + 1
    end
  end
  return count
end

local function valid_ipv6(address)
  if not address:find(":", 1, true) then return false end
  local compression = address:find("::", 1, true)
  if compression then
    if address:find("::", compression + 2, true) or address:sub(1, compression - 1):find(".", 1, true) then
      return false
    end
    local left = ipv6_group_count(address:sub(1, compression - 1))
    local right = ipv6_group_count(address:sub(compression + 2))
    return left ~= nil and right ~= nil and left + right < 8
  end
  return ipv6_group_count(address) == 8
end

local function valid_resolver_authority(authority)
  if authority:find("@", 1, true) or authority:find("[^%w%.:%-%[%]]") then return false end

  if authority:sub(1, 1) == "[" then
    local address, port = authority:match("^%[([^%]]+)%]:(%d+)$")
    if not address then address = authority:match("^%[([^%]]+)%]$") end
    return address ~= nil and valid_ipv6(address) and (port == nil or valid_port(port))
  end

  local host, port = authority:match("^([%w%.%-]+):(%d+)$")
  if not host then
    host = authority
    if host:find(":", 1, true) then return false end
  end
  if port and not valid_port(port) then return false end
  if host:match("^[%d%.]+$") then return valid_ipv4(host) end
  if host == "" or #host > 253 or host:find("%.%.") or host:sub(1, 1) == "." or host:sub(-1) == "." then
    return false
  end
  for label in host:gmatch("[^%.]+") do
    if #label > 63 or label:sub(1, 1) == "-" or label:sub(-1) == "-" then return false end
  end
  return true
end

local function resolver_base_url()
  local configured = type(env) == "table" and env.HYPERCERTS_HANDLE_RESOLVER_URL or nil
  if type(configured) ~= "string" or #configured > 2048
    or configured:find("[%c%s]") or configured:find("\\", 1, true) or configured:find("%", 1, true) then
    return nil
  end

  local scheme, authority, suffix = configured:match("^([%a]+)://([^/?#]+)(.*)$")
  if not scheme or scheme:lower() ~= "https" or not authority
    or (suffix ~= "" and suffix ~= "/") or not valid_resolver_authority(authority) then
    return nil
  end
  return "https://" .. authority
end
