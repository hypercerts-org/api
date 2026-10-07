local WORKSCOPE_TAG = "org.hypercerts.workscope.tag"
local WORKSCOPE_TAG_NULL = json.decode("null")

local function workscope_tag_valid_record_uri(value)
  return valid_record_uri(value)
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
