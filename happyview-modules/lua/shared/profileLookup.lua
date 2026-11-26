local function fail_resolution()
  error("HandleResolutionFailed: handle could not be resolved", 0)
end

local function fail_resolver_config()
  error("HandleResolverConfigError: HYPERCERTS_HANDLE_RESOLVER_URL must be an HTTPS resolver base URL with no credentials, path, query, or fragment; fix or remove this HappyView script variable (unset uses the default resolver)", 0)
end

local function resolve_handle(handle)
  local base = resolver_base_url()
  if not base then fail_resolver_config() end
  local url = base .. "/xrpc/com.atproto.identity.resolveHandle?handle=" .. encode_query_value(handle)
  local resolved = fetch_resolver_json(url)
  if not resolved or not valid_did(resolved.did) then fail_resolution() end
  return resolved.did
end

local function get_profile()
  keys_only(params, { actor = true })
  local actor = scalar(params, "actor")
  if not actor then invalid("actor must be a DID or handle") end

  local did
  if actor:sub(1, 4) == "did:" then
    if not valid_did(actor) then invalid("actor must be a valid DID or handle") end
    did = actor
  else
    local handle = actor:lower()
    if not valid_handle(handle) then invalid("actor must be a valid DID or handle") end
    did = resolve_handle(handle)
  end

  local rows = query(
    "SELECT uri, did, cid, indexed_at::text AS indexed_at, record::text AS record FROM happyview_records WHERE collection = $1 AND did = $2 AND rkey = 'self' LIMIT 1",
    { PROFILE, did })
  if #rows == 0 then error("RecordNotFound: profile is not indexed", 0) end
  return { profile = record_view(rows[1]) }
end
