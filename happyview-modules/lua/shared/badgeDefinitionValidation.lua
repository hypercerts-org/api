local BADGE_DEFINITION_COLLECTION = "app.certified.badge.definition"

local function valid_badge_definition_uri(value)
  local valid, collection = valid_record_uri(value)
  return valid and collection == BADGE_DEFINITION_COLLECTION
end
