# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` declares shared record/view Lexicons; `modules/context-measurements/manifest.json` registers the public measurement query handlers. The `badge-queries` module registers five public badge query Lexicons and their Lua handlers.

## Measurement queries

Both queries are publicly readable and require no authentication:

- `org.hypercerts.context.getMeasurement` accepts a full measurement AT-URI with a DID authority. It returns `RecordNotFound` when that exact URI is not indexed and `InvalidRequest` for an invalid or wrong-collection URI.
- `org.hypercerts.context.listMeasurements` accepts repeated, unbracketed `authors` and `subjects` query parameters. Each accepts at most 100 values; duplicate values are removed. `limit` defaults to 25 and is bounded from 1 through 100. `sortDirection` defaults to `desc`.

Example:

```text
/xrpc/org.hypercerts.context.listMeasurements?authors=did%3Aplc%3Apublisher-a&authors=did%3Aplc%3Apublisher-b&subjects=at%3A%2F%2Fdid%3Aplc%3Aproject%2Forg.hypercerts.claim.activity%2F3jzfcijpj2z2a&limit=25
```

`authors` matches the repository owner (`did`), not `record.measurers`. `subjects` matches a supplied AT-URI against any `record.subjects[].uri`; the subject's CID is ignored. Values within one filter are ORed, while `authors` and `subjects` are ANDed. With neither filter, results are global and include measurements without subjects.

Results sort by `(createdAt, uri)` in the requested direction. If `createdAt` is missing or invalid, ordering falls back to `indexed_at`, then the stored row creation time; this never rewrites the returned record. A next-page cursor is opaque and tied to `sortDirection`; keep the filter parameters unchanged when continuing pagination. The cursor is omitted when there is no next page. Each result includes its complete original record, including `value` as a numeric string. `indexedAt` is always present and is JSON `null` when the indexed row has SQL `NULL` in `indexed_at`. The publisher's Certified profile and organization sidecar are hydrated; missing sidecars are `null`. Subjects, locations, and measurers remain unexpanded. Database and hydration failures propagate as operational errors rather than being converted into missing records.

The Lua handlers query `happyview_records` on PostgreSQL. Exact lookup binds the full AT-URI; listing uses repository DID matching, JSONB array expansion for subject URI matching, and keyset pagination over `(createdAt, uri)`. Actor hydration uses the shared `actorView.lua` projection. The `measurementView` Lexicon is owned by `getMeasurement` and reused by `listMeasurements`. Safe fallback validation uses PostgreSQL `pg_input_is_valid`, so the listing endpoint requires PostgreSQL 16 or newer; the target runtime version was not verified in this checkout.

## Local checks

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test:unit
pnpm check
pnpm build
PSQL_PATH="$(command -v psql)" pnpm test:http
```

`pnpm test:unit` and `pnpm check` run the recursively discovered tests under `api/tests/unit`; unit tests do not require HappyView or PostgreSQL. `pnpm check` also validates generated-source freshness, JavaScript/Lua lint, and types. `pnpm build` emits only Lua handlers declared by the root and module manifests. Shared Lua files are bundled into capability handlers but are not installed independently.

`pnpm test:http` requires a local Docker Compose daemon, `psql`, and the pinned PostgreSQL and HappyView images already present in the local image cache. The local runner never pulls images. The CI workflow explicitly pulls only the two digest-pinned test images before running the same command. Set `PSQL_PATH` to the absolute path returned by `command -v psql`.

## HTTP runtime tests

HTTP suites live in `api/tests/http` and call the funding, badge-definition, context-measurement, and contribution XRPC endpoints installed from the current checkout. `pnpm test:http` discovers `*.http.test.js` suites and fixture modules named `*.fixture.js`, then creates a random Compose project with loopback-only dynamic ports, PostgreSQL data on tmpfs, and a task-owned default bridge network. Bridge networking permits container egress. HappyView receives loopback placeholder upstream URLs and proxy variables pointing to `127.0.0.1:9`; these are application-level settings, not network-hard egress isolation. The installer and HTTP suites target only the task-owned loopback service. The runner installs this checkout's manifest, seeds shared and HTTP fixtures, runs the suites, and tears down only that generated Compose project and its temporary credentials. Locally, Compose uses `--pull never`; missing cached images fail before service startup.

The HTTP gate fails when it discovers zero suites, executes zero `node:test` cases, or runs only skipped cases. These checks cover real HTTP behavior against PostgreSQL, not just Lua handlers with a fake database. Funding coverage exercises record retrieval, repeated filters, and pagination. Badge-definition coverage exercises retrieval with an icon and allowed-issuer list, publisher-sidecar hydration, author and badge-type filters, createdAt/URI pagination ties, and named error responses. Context-measurement coverage exercises exact record retrieval and publisher-sidecar hydration, repeated author/subject filters and negative results, timestamp/URI tie pagination in both directions, missing sidecars, and named runtime errors. Contribution coverage exercises exact retrieval, repeated publisher filters, tied ascending/descending cursor pagination, nullable publisher sidecars, and named errors. HTTP fixtures use CBOR-derived record CIDs and are seeded only into the task-owned disposable database.

For the pinned HappyView release, ordinary Lua `error()` exceptions are returned as HTTP 500 JSON with `error: "script_error"` and `errorType: "runtime"`; the error name appears in `message`. The negative HTTP tests assert this observed runtime behavior. They do not define an ideal public HTTP status contract or guarantee 4xx mapping for `RecordNotFound` and `InvalidRequest`.

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
