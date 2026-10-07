# Consumer workflow recipes

These recipes show endpoint choice and the data to carry between calls. For exact parameters, response fields, cursor rules, or declared errors, inspect the corresponding operation and schemas in the [bundled OpenAPI contract](openapi.json).

## Search or list activities

1. **Choose by the question.** Use `org.hypercerts.claim.searchActivities` for a text search. Its required `search` is currently a case-insensitive literal substring of title or short description. Use `org.hypercerts.claim.listActivities` when the task is structured discovery by author, contributor, involved actor, URI, or organization-record presence and does not need text matching.
2. **Use the correct actor role.** `authors` means the activity repository-owner DID; `contributors` filters contributor DIDs; `involvedActors` has its own combined meaning. Do not substitute one because the same DID appears in the record.
3. **Build a bounded page.** Send a moderate `limit` and the exact filters/sort documented for that operation. Array-valued filters use repeated unbracketed query keys where declared. Search/filter combination and array OR/AND semantics are operation-specific.
4. **Continue consistently.** If the response includes a cursor, carry it forward with the same search, all filters, and sort direction. Stop when the cursor is omitted. A changed filter or direction starts a new traversal; do not attach an old cursor to a new query.
5. **Use a detail call only when needed.** A returned activity includes its URI/CID and hydrated view. For a later exact lookup, pass its AT-URI to `org.hypercerts.claim.getActivity`.

**Likely failure modes:** `search` is required even if the client wants a text search; invalid filters/cursors are not “no results”; a required hydration/query failure can fail the operation rather than produce a partial activity list. A missing exact activity from `getActivity` is distinct from an empty list. Check the operation's declared error codes and see [reliability.md](reliability.md).

## Load exact collection item versions

1. If the collection URI is known, optionally load its current indexed view with `org.hypercerts.collection.getCollection` and retain the collection AT-URI. Do not treat that URI as a CID-pinned collection version.
2. Call `org.hypercerts.collection.listCollectionItems` with `collection=<full collection AT-URI>` and a bounded `limit`. It follows the collection's embedded item order; there is no `sortDirection` parameter.
3. Preserve each item's `itemIdentifier.uri` **and** `itemIdentifier.cid`. This strong reference identifies the intended item version. Consume the resolved `record` only as that exact version; do not replace a null result with a newer record found by URI alone.
4. `record` may be null when the exact version is unavailable or the kind is unsupported. Nested collections are returned as one-level summaries, not recursively expanded. A null resolution is a valid item result, not necessarily a failed page.
5. For another page, reuse the same collection URI and cursor. The cursor follows the latest indexed collection at that URI across pages, not a pinned collection version. If the collection changes, item additions/removals/reordering can cause repeats or skips; the endpoint does not promise snapshot pagination.

**Likely failure modes:** passing a record URI where the required collection URI belongs; discarding CID and accidentally displaying a different version; assuming nested collections are expanded; or assuming pages represent one immutable collection snapshot. Inspect `org.hypercerts.collection.listCollectionItems` and `org.hypercerts.collection.getCollection` in the [bundled OpenAPI contract](openapi.json) before relying on resolution details.

## Load profile and organization context

1. For one actor profile, call `app.certified.actor.getProfile` with a DID or handle. For many known actor DIDs, use `app.certified.actor.getProfiles` with repeated `actors` values; the returned results correspond to the input occurrences and `profile` can be null.
2. For organization sidecar context, use `app.certified.actor.getOrganization` with an actor DID or batch known DIDs with `app.certified.actor.getOrganizations`. In batch results, an absent organization is represented by a null `organization` for that actor. The organization actor view's `profile` may independently be null.
3. Use `listProfiles` / `listOrganizations` to browse and the corresponding `search...` endpoint for text discovery. Do not try to resolve handles in the batch APIs: their contract is DID input. `getProfile` handle resolution depends on the configured resolver and is not independent DID-document verification.
4. When another endpoint already returns an author/actor view, inspect that view's contract before issuing a second hydration call. Optional profile or organization projections can be null; fetching the full view again may add work without making the indexed data fresher.

**Likely failure modes:** treating no indexed profile as an invalid DID, interpreting a missing organization sidecar as a missing actor, assuming profile and organization presence move together, or treating handle resolution failure as proof that the actor has no profile. See [reliability.md](reliability.md) for the distinction between null, not-found, and query failure.

## Read badge award response status

1. For one known award, call `app.certified.badge.getBadgeAward` with the award's full AT-URI. The `badgeAward` view exposes `responseStatus`: `accepted`, `rejected`, or `unanswered`.
2. Treat `unanswered` as a successful award with no eligible response in the indexed view. Its `recipientResponse` is nullable. A missing badge definition projection (`badge: null`) is separate from response status.
3. When discovering multiple awards, use `app.certified.badge.listBadgeAwards` and its documented filters/page rules; status is part of those award views. Use `app.certified.badge.getBadgeResponse` for one known raw response URI or `app.certified.badge.listBadgeResponses` to inspect raw responses, optionally filtering by award AT-URI.
4. Do not infer an award's derived status solely from whichever raw response records happen to be in a partial page. `getBadgeAward` is the direct status surface; its exact latest-eligible-response rule is defined in the bundled OpenAPI operation.

**Likely failure modes:** confusing `RecordNotFound` for the award with `unanswered`; assuming a raw response list is a status summary; or treating a null definition projection as a rejected/unanswered response. Inspect `app.certified.badge.getBadgeAward` and `app.certified.badge.listBadgeResponses` in the [bundled OpenAPI contract](openapi.json) for their exact parameters, response fields, and declared errors.
