local VOCAB_TAG = "org.hypercerts.vocab.tag"

local function valid_vocab_did(value)
  if not valid_did(value) then return false end
  local position = 1
  while true do
    local percent = value:find("%", position, true)
    if not percent then return true end
    if not value:sub(percent + 1, percent + 2):match("^%x%x$") then return false end
    position = percent + 3
  end
end

local function valid_vocab_tag_uri(value)
  local valid, collection, authority = valid_record_uri(value)
  if not valid or collection ~= VOCAB_TAG then return false end
  return valid_vocab_did(authority)
end

local function hydrate_vocab_actor_views(actors, run_query)
  hydrate_actor_views(actors, run_query)
  -- Vocab sidecars preserve the omission; only the top-level tag emits indexedAt as JSON null.
  for _, actor in ipairs(actors) do
    if actor.profile ~= NULL and actor.profile.indexedAt == NULL then actor.profile.indexedAt = nil end
    if actor.organization ~= NULL and actor.organization.indexedAt == NULL then actor.organization.indexedAt = nil end
  end
end
