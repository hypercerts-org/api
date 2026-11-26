local MINI_DOC_PATH = "/xrpc/blue.microcosm.identity.resolveMiniDoc?identifier="

-- One best-effort lookup, for getActor only. HappyView Lua HTTP is serial, so
-- batch endpoints must not call this.
local function hydrate_actor_handle(actor)
  local base = resolver_base_url()
  if not base or type(http) ~= "table" or type(http.get) ~= "function" then return end

  local resolved = fetch_resolver_json(base .. MINI_DOC_PATH .. encode_query_value(actor.did))
  if resolved and resolved.did == actor.did and valid_handle(resolved.handle)
    and not resolved.handle:find("[^A-Za-z0-9.%-]") and resolved.handle:match("%.[A-Za-z][^.]*$") then
    local handle = resolved.handle:lower()
    if handle ~= "handle.invalid" then actor.handle = handle end
  end
end
