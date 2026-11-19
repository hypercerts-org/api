local CREATED_AT_SORT_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"

-- Sort key for a happyview_records row: the record's own createdAt when it is a
-- valid timestamp, otherwise COALESCE(indexed_at, created_at). `alias` is the
-- table alias; nil selects unqualified columns.
local function created_at_sort(alias)
  local prefix = alias and (alias .. ".") or ""
  local record, indexed_at, created_at = prefix .. "record", prefix .. "indexed_at", prefix .. "created_at"
  local created = record .. "::jsonb->>'createdAt'"
  return "CASE WHEN jsonb_typeof(" .. record .. "::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. CREATED_AT_SORT_PATTERN .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE COALESCE(" .. indexed_at ..
    "::timestamptz, " .. created_at .. "::timestamptz) END"
end
