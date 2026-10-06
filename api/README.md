# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` contains record schemas and query Lexicons used as shared view types; it contains no Lua endpoint scripts. A foundation-only install therefore does not implement those queries. Capability modules listed in the root manifest register their endpoint Lexicons and handlers separately, including the public `org.hypercerts.claim.getRights` and `org.hypercerts.claim.listRights` queries from `modules/rights/manifest.json`. The `badge-queries` module installs five public badge query Lexicons and their Lua handlers.

## Acknowledgement queries

The public `org.hypercerts.context.getAcknowledgement` query accepts one exact acknowledgement AT-URI with a DID authority. It returns `RecordNotFound` when the acknowledgement is not indexed. `org.hypercerts.context.listAcknowledgements` lists indexed acknowledgements globally or with repeated, unbracketed `authors` (DIDs) and `subjects` (AT-URIs) parameters. Values within either filter use OR; the filters combine with AND. Subject matching compares only `record.subject.uri`, not its CID.

Listing sorts by `(createdAt, uri)`, descending by default, with `limit=25` by default and a maximum of 100. The opaque cursor is bound to `sortDirection`; keep the other request parameters unchanged when continuing a page. The response preserves each full record unchanged and hydrates its publisher's Certified profile and raw organization sidecar. A missing profile or sidecar is `null`; `indexedAt` is also `null` when the index has no timestamp. Subject and context references remain unexpanded. These queries do not verify publisher authority or calculate a combined acknowledgement status.

The `modules/acknowledgements/manifest.json` bundle installs the acknowledgement record Lexicon and both query handlers. Runtime queries require the HappyView PostgreSQL index to contain acknowledgement records and publisher profile/organization records. `AcknowledgementQueryFailed` indicates a database or hydration lookup failure; check HappyView's PostgreSQL service rather than treating it as a missing record. Authentication is not required.

## Contribution queries

`org.hypercerts.claim.getContribution` and `org.hypercerts.claim.listContributions` are public queries. The singular endpoint requires a full contribution-record AT-URI whose authority is a DID and returns `RecordNotFound` when that exact indexed record is absent.

The list endpoint accepts repeated, unbracketed `authors` query keys containing publisher repository DIDs. Values are ORed and limited to 100; `sortDirection` is `asc` or `desc` (default `desc`), and `limit` is 1–100 (default 25). Pages sort by the record's `createdAt`, falling back to `indexed_at` and then stored row creation time when missing or malformed, then by URI in the same direction. The opaque cursor is bound to the sort direction; keep the filters unchanged when requesting later pages.

Both endpoints return the complete contribution record unchanged plus publisher metadata and a hydrated `author`. The publisher DID is the record repository owner, not necessarily the contributor. Missing profile or raw organization sidecar records are returned as `null`; referring activities are not expanded. The `getContribution` Lexicon owns the `contributionView` definition reused by both query responses. Invalid input returns `InvalidRequest`, missing singular records return `RecordNotFound`, and PostgreSQL lookup or hydration failures return `ContributionQueryFailed`.

The current design requires `indexedAt` to be present but nullable; the older `contributionView` proposal omitted that nullable declaration, so this Lexicon follows the current design.

The shared module registers the contribution record Lexicon with backfill enabled; the contribution module registers both query Lexicons and Lua handlers. Installing the bundle through `pnpm install:api` writes these declarations and scripts to the configured HappyView instance, so use the existing approved-target and admin-token procedure before running it.

For local development checks and HTTP runtime test requirements, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Install a released API bundle

Releases version the installable API bundle in this package; they do not publish to npm or deploy to a HappyView instance. This public repository's GitHub Releases and tagged source archives are the distribution channel. Choose an `@hypercerts-org/hypercerts-api@X.Y.Z` release tag, clone that snapshot, install its pinned workspace dependencies from the repository root, then run the installer from `api/`:

```sh
git clone --depth 1 --branch '@hypercerts-org/hypercerts-api@X.Y.Z' https://github.com/hypercerts-org/api.git hypercerts-api
cd hypercerts-api
pnpm install --frozen-lockfile
cd api
HAPPYVIEW_BASE_URL='https://your-happyview.example' HAPPYVIEW_ADMIN_TOKEN='<scoped-admin-token>' pnpm install:api
```

Review that release's notes and target only an explicitly approved HappyView instance.

## Rights queries

- `org.hypercerts.claim.getRights` accepts the exact rights-record AT-URI with a DID authority. An unindexed record returns `RecordNotFound`.
- `org.hypercerts.claim.listRights` accepts up to 100 repeated, unbracketed `authors` keys; values use OR. Pages default to 25 and cap at 100. Ordering uses `(createdAt, uri)`; missing or malformed record timestamps fall back to `indexed_at`, then row creation time. Cursors are opaque and bound to sort direction; a terminal page omits `cursor`.
- Both queries preserve the full indexed record and hydrate the publisher's Certified profile and raw organization sidecar. Missing author records are `null`; SQL `NULL` `indexed_at` is returned as JSON `null` without inventing a timestamp. Query or hydration failures return errors. Attachments and activities referencing rights are not expanded.
- The unpublished `rightsView` response definition is local to `org.hypercerts.claim.getRights`; `listRights` references that definition. Its `indexedAt` property is required but nullable to match indexed rows. Older proposal prose that describes it as non-nullable is stale.
- Rights listing uses PostgreSQL 16+ `pg_input_is_valid` timestamp validation; the canonical HappyView deployment and test configurations default to PostgreSQL 17.

The shared module registers the pinned rights-record Lexicon with backfill enabled, so an approved install can index existing rights records.

The reusable installer validates every local asset and dependency before making admin requests. `pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. It does not roll back writes if a later asset fails.

## Vocabulary tag queries

The default API bundle registers two public, unauthenticated endpoints for indexed `org.hypercerts.vocab.tag` records:

- `org.hypercerts.vocab.getVocabTag` accepts `uri=at://<did>/org.hypercerts.vocab.tag/<rkey>` and returns `{ vocabTag }`. The URI must use a DID authority and identify this exact collection. An unindexed URI returns `RecordNotFound`.
- `org.hypercerts.vocab.listVocabTags` returns `{ vocabTags, cursor? }`. Its only filter is `authors`, encoded as repeated unbracketed query keys; values are publisher DIDs combined with OR. It accepts at most 100 supplied values before deduplication.

The `getVocabTag` Lexicon owns the `vocabTagView` response definition; the list Lexicon reuses it.

For example, a listing request may contain `?authors=did%3Aplc%3A...&authors=did%3Aplc%3A...&limit=25&sortDirection=desc`. Omitting `authors` leaves the publisher dimension unrestricted; an empty-string value is invalid, not an empty-array sentinel. Unknown parameters, repeated scalar parameters, invalid DIDs, limits outside 1–100, and malformed or mismatched cursors return `InvalidRequest`.

Listings default to 25 records and descending order, with a maximum page size of 100. Results use keyset pagination over `(createdAt, uri)` in the selected direction; invalid or absent record timestamps fall back to `indexed_at`, then the stored row creation time. Cursors are opaque, bind the sort direction and normalized author filter, and do not promise a snapshot while the index changes. Keep filters and sort direction unchanged between pages. The response omits `cursor` when exhausted.

Both endpoints return the complete indexed record unchanged and hydrate the publisher's Certified profile plus raw organization sidecar. Every view includes `indexedAt`, using JSON `null` when the indexed row has no timestamp. Missing sidecars are `null`; operational query or hydration failures return `VocabTagQueryFailed`, never a partial page. Taxonomy links and external references remain unexpanded. Name, category, status, hierarchy, and text-search filters are intentionally not part of this API.

The handler and Lexicons are declared in `modules/vocab/manifest.json`, included by the root aggregate manifest, and bundled from `lua/src/` into `lua/endpoints/`. `pnpm install:api` contacts the configured HappyView admin service and writes assets; run it only with an explicitly approved instance and credentials. Offline validation does not require or contact a HappyView service.

## Badge query endpoints

`modules/badge-queries/manifest.json` registers `searchBadgeDefinitions`, `getBadgeAward`, `listBadgeAwards`, `getBadgeResponse`, and `listBadgeResponses`. They read indexed PostgreSQL records and require no caller authentication. The shared module registers the badge definition, award, and response record schemas with backfill enabled; the query module does not add or migrate database tables.

Definition search trims the required `search` value and matches it as a case-insensitive literal substring in `title` or `description`; blank text is unrestricted. `authors` and `badgeTypes` are repeated query parameters with OR within each filter. Award-list filters combine with AND, while values in each array use OR. `subjects` accepts only DIDs or full record AT-URIs with valid collection NSIDs and matches only the corresponding DID or strong-reference URI variant; invalid entries reject the request. Badge-type filtering and embedded `badge` data use the exact definition URI and CID pinned by the award, while `badgeUris` compares only the URI.

Award views keep each award distinct and include `responseStatus` plus `recipientResponse`. The legitimate recipient is the subject DID or the DID in a record subject AT-URI. Only that repository's accepted or rejected response with the exact award URI and CID is eligible; unknown open response values remain visible in raw response queries but do not replace a prior eligible response. The latest eligible response is selected by index order and URI, not client `createdAt`. Missing exact definition versions remain visible as `badge: null`; absent eligible responses are `unanswered`. Raw response lookups and listings preserve history, include non-recipient records, and do not expand the referenced award. `listBadgeResponses` filters by award URI only.

All list endpoints use a default page size of 25, accept limits from 1 to 100, sort by `(createdAt, uri)` descending by default, and return an opaque cursor only when another page exists. Keep filters and sort direction unchanged when following a cursor. Repeated array parameters are limited to 100 supplied values; unknown parameters and repeated scalar parameters are rejected.
