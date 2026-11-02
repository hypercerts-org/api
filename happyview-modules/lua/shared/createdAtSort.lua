local CREATED_AT_SORT_COLUMNS = {
  profile = { record = "record", indexed_at = "indexed_at", created_at = "created_at" },
  organization = {
    record = "organization.record",
    indexed_at = "organization.indexed_at",
    created_at = "organization.created_at",
  },
  activity = {
    record = "activity.record",
    indexed_at = "activity.indexed_at",
    created_at = "activity.created_at",
  },
  collection = {
    record = "collection.record",
    indexed_at = "collection.indexed_at",
    created_at = "collection.created_at",
  },
}
local CREATED_AT_SORT_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]+)?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$"

local function created_at_sort_expression(source)
  local columns = CREATED_AT_SORT_COLUMNS[source]
  if not columns then
    error("CreatedAtSortExpressionError: source must be 'profile', 'organization', 'activity', or 'collection'", 0)
  end

  local created = columns.record .. "::jsonb->>'createdAt'"
  return "CASE WHEN jsonb_typeof(" .. columns.record .. "::jsonb->'createdAt') = 'string' AND " .. created ..
    " ~ '" .. CREATED_AT_SORT_PATTERN .. "' AND " .. created .. " !~ '-00:00$' AND pg_input_is_valid(" .. created ..
    ", 'timestamptz') THEN (" .. created .. ")::timestamptz ELSE COALESCE(" .. columns.indexed_at ..
    "::timestamptz, " .. columns.created_at .. "::timestamptz) END"
end
