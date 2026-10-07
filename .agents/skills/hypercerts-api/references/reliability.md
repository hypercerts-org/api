# Identity, freshness, nulls, and errors

## Keep actor, record, and version identity distinct

- **DID** (`did:...`) identifies an actor/repository. Actor filters and some `actor` parameters expect DIDs; check each schema. In record views, `did` is commonly the publisher/repository DID, not a version identifier.
- **AT-URI** (`at://<DID>/<collection>/<rkey>`) identifies a record location. It is the input for many `uri` parameters and may identify the current indexed version at that location; it does not pin a particular content version.
- **CID** identifies record content at a version. A strong reference carries both URI and CID. Preserve both when the source contract uses a strong reference.

A handle is a resolvable actor identifier, not a DID or record URI. `app.certified.actor.getProfile` accepts a DID or handle and uses the configured handle resolver; the declared contract does not claim independent DID-document verification. Batch profile/organization lookups take DIDs.

### Exact collection item versions

`org.hypercerts.collection.listCollectionItems` resolves each embedded item's strong reference by exact URI **and** CID. If the requested CID is unavailable, the item's `record` can be null; do not silently substitute a newer record at the same URI. Nested collections are summaries, not recursive expansion. By contrast, collection discovery filters such as `itemUris` and `tagUris` currently match AT-URIs without selecting a CID version. See [recipes.md](recipes.md#load-exact-collection-item-versions) and the operation's details in the bundled OpenAPI contract before relying on exact-version behavior.

## Indexed data is not a live repository read

Queries return indexed public data. Do not promise immediate visibility after a record changes, infer that the absence of an indexed row proves that no source record exists, or assume pages share a database snapshot. `indexedAt` may be nullable even when the field is required in a view.

For a potentially fresh record that is absent:

1. Validate the input kind and authority (DID vs AT-URI), then check the exact endpoint's required parameters and declared errors in the bundled OpenAPI contract.
2. Distinguish a successful empty list or nullable projection from a failed exact lookup. If the application expects newly indexed data, use a bounded retry/backoff or show a pending/stale state rather than claiming certainty.
3. Keep a cursor with the query that produced it. Repeating or changing filters can produce different pages; some operations explicitly document non-snapshot or mutable-source behavior. For example, collection-item pagination follows the latest indexed collection at that URI and can repeat/skip items if it changes; the recent-follows feed also documents non-snapshot behavior.
4. The bundled contract snapshot describes declared behavior, not a specific deployment version or index freshness. Use the API directly when the task needs live indexed results; do not send unrelated availability probes. A deployment-specific availability check requires explicit approval for the target.

## Null, omitted, empty, not-found, and failure are different

- **Null field:** the endpoint returned a known enclosing result, but one optional or nullable projection is unavailable/absent under that contract. Examples include a null profile in batch `getProfiles`, a null organization in `getOrganizations`, a null `follow` in `getFollow`, or a null resolved collection-item `record`. Preserve and render this state intentionally.
- **Omitted optional field:** the schema does not require the property in that condition. Do not treat omission as the same representation as explicit null unless the exact endpoint contract says so.
- **Empty list:** the query succeeded and returned no matching items. It is not the same as an invalid query or failed hydration.
- **Not-found error:** a `get...` query may declare `RecordNotFound` when no matching record is indexed. That is not necessarily a successful response containing a null record. Use the endpoint's own declared error contract.
- **Query/hydration error:** an operation may fail if required indexed data cannot be queried or hydrated. Do not hide it by returning an empty list or null unless the endpoint explicitly defines that behavior.
- **Domain status:** `getBadgeAward` can return a valid award with `responseStatus: "unanswered"` and `recipientResponse: null`. That is neither a not-found error nor a failed request. The award view can separately have `badge: null` if its definition projection is unavailable.

A nullable actor profile does not imply an invalid DID; a missing organization sidecar does not prove the actor is missing; an unavailable exact CID does not prove another version at that URI is absent.

For `org.hypercerts.context.getEvaluation` and `listEvaluations`, the top-level `record` remains the indexed value. The separate hydrated `evaluators` array is a dense projection of entries shaped as objects with valid DIDs; malformed entries are omitted, and a missing or non-array source yields an empty projection. Do not treat an empty projection as proof that the raw record had no evaluator data. More than 1,000 raw entries remains outside the supported limit: exact lookup fails and lists skip that record.

## Diagnose failures without overgeneralizing

1. Record HTTP status and parse the JSON XRPC error code/message when present; preserve a fallback for empty or non-JSON bodies. See [request-patterns.md](request-patterns.md#handle-http-and-xrpc-errors).
2. Inspect the exact endpoint's declared errors in the bundled [OpenAPI contract](openapi.json). `InvalidRequest`, `RecordNotFound`, resolver errors, and query/hydration errors indicate different next steps; don't assume every endpoint declares the same codes or status mapping.
3. For `InvalidRequest`, verify full NSID path, parameter names, encoding, required values, array limits, type/format, cursor, and sort/filter preservation.
4. For a not-found or empty result, verify the identifier is the expected DID/AT-URI and consider index freshness. Do not silently downgrade a failure into absence.
5. The bundled snapshot cannot establish that an endpoint is enabled on the selected host. If deployment availability itself is the user's request, make only a scoped check against the explicitly approved target; otherwise, do not infer availability from the contract or probe the host.
