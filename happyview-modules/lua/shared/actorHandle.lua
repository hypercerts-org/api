local MAX_ACTOR_HANDLE_LOOKUPS = 50
local MINI_DOC_PATH = "/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier="

-- Actors are already unique and in first occurrence order. HTTP runs serially;
-- this budget bounds attempt count, not elapsed time.
local function hydrate_actor_handles(actors)
  local base = resolver_base_url()
  if not base or type(http) ~= "table" or type(http.get) ~= "function" then return end

  for index = 1, math.min(#actors, MAX_ACTOR_HANDLE_LOOKUPS) do
    local actor = actors[index]
    local resolved = fetch_resolver_json(base .. MINI_DOC_PATH .. encode_query_value(actor.did))
    if resolved and resolved.did == actor.did and valid_handle(resolved.handle)
      and not resolved.handle:find("[^A-Za-z0-9.%-]") and resolved.handle:match("%.[A-Za-z][^.]*$") then
      local handle = resolved.handle:lower()
      if handle ~= "handle.invalid" then actor.handle = handle end
    end
  end
end
