local WORKSCOPE_TAG = "org.hypercerts.workscope.tag"
local WORKSCOPE_TAG_NULL = json.decode("null")

local function workscope_tag_valid_did(value)
  if not valid_did(value) then return false end
  local offset = 1
  while true do
    local percent = value:find("%", offset, true)
    if not percent then return true end
    local escape = value:sub(percent + 1, percent + 2)
    if not escape:match("^[0-9A-Fa-f][0-9A-Fa-f]$") then return false end
    offset = percent + 3
  end
end

local function workscope_tag_valid_record_uri(value)
  local valid, collection, authority = valid_record_uri(value)
  return valid and workscope_tag_valid_did(authority), collection
end

local function workscope_tag_query(sql, values)
  if db.backend() ~= "postgres" then
    error("WorkscopeTagQueryFailed: workscope-tag API requires PostgreSQL", 0)
  end
  local ok, result = pcall(db.raw, sql, values)
  if not ok or type(result) ~= "table" then
    error("WorkscopeTagQueryFailed: work-scope tag query failed", 0)
  end
  return result
end

local function workscope_tag_view(row)
  return {
    uri = row.uri,
    cid = row.cid,
    indexedAt = row.indexed_at == nil and WORKSCOPE_TAG_NULL or row.indexed_at,
    did = row.did,
    author = { did = row.did },
    record = json.decode(row.record),
  }
end
