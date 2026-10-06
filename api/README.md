# HappyView API toolkit and query modules

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, offline fixture/test utilities, and the feature, contribution, badge-query, vocabulary-tag, and acknowledgement modules. The `modules/shared/manifest.json` contains record schemas and shared query/view Lexicons; it contains no Lua endpoint scripts. A foundation-only install does not implement those queries. Capability modules listed in the root manifest register their endpoint Lexicons and Lua handlers separately; the `badge-queries` module installs five public badge query Lexicons and their Lua handlers.

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

HTTP suites live in `api/tests/http` and exercise the funding, badge-definition, badge-query, feature, work-scope-tag, contribution, context-measurement, profile, organization, context attachment and evaluation, activity, collection, acknowledgement, vocabulary-tag, graph, and location XRPC endpoints installed from the current checkout. `pnpm test:http` discovers `*.http.test.js` suites and fixture modules named `*.fixture.js`, then creates a random Compose project with loopback-only dynamic ports, PostgreSQL data on tmpfs, and a task-owned default bridge network. Bridge networking permits container egress. HappyView receives loopback placeholder upstream URLs and proxy variables pointing to `127.0.0.1:9`; these are application-level settings, not network-hard egress isolation. The installer and HTTP suites target only the task-owned loopback service. The runner installs this checkout's manifest, seeds shared and HTTP fixtures, runs the suites, and tears down only that generated Compose project and its temporary credentials. Locally, Compose uses `--pull never`; missing cached images fail before service startup.

The HTTP gate fails when it discovers zero suites, executes zero `node:test` cases, or runs only skipped cases. These checks cover real HTTP behavior against PostgreSQL, not just Lua handlers with a fake database. Funding coverage exercises record retrieval, repeated filters, and pagination. Badge-definition coverage exercises retrieval with an icon and allowed-issuer list, publisher-sidecar hydration, author and badge-type filters, createdAt/URI pagination ties, and named error responses. Badge-query coverage exercises baseline-aware definition feeds and discriminating filters, exact-version award/response lookups, recipient status, raw response history, bidirectional tied pagination, nullable sidecars, and named runtime errors. Vocabulary-tag coverage exercises exact retrieval, author filters, hydrated and nullable sidecars, tied pagination, and named errors. Acknowledgement coverage exercises exact retrieval, hydrated and absent publisher sidecars, repeated author/subject filters, tied pagination in both directions, and named errors. Feature coverage exercises exact retrieval and author hydration, list filters and sidecars, tied createdAt/URI pagination, and named errors. Contribution coverage exercises exact-record retrieval, repeated publisher filters, tied ascending/descending cursor pagination, nullable publisher sidecars, and named errors. Fixtures use CBOR-derived record CIDs and are seeded only into the task-owned disposable database.

For the pinned HappyView release, ordinary Lua `error()` exceptions are returned as HTTP 500 JSON with `error: "script_error"` and `errorType: "runtime"`; the error name appears in `message`. The negative HTTP tests assert this observed runtime behavior. They do not define an ideal public HTTP status contract or guarantee 4xx mapping for `RecordNotFound` and `InvalidRequest`.

## Feature query API

Both feature queries are public and require no authentication. The aggregate manifest includes the feature module and its validation Lexicons; the handlers read indexed records from PostgreSQL `happyview_records`.

`org.hypercerts.entity.getFeature` accepts the exact feature record AT-URI, including its DID authority and record key. It returns `InvalidRequest` for malformed or non-feature URIs and `RecordNotFound` when that exact URI is not indexed. The `FeatureView` preserves the indexed record and hydrates only the author's profile and organization sidecar; either actor record may be null, and feature locations, tags, and `sameAs` references remain unexpanded.

`org.hypercerts.entity.listFeatures` accepts repeated, unbracketed `authors` and `types` query keys, with at most 100 values per array. Different filters combine with AND, while values within either array combine with OR. Authors are repository-owner DIDs; types are exact, case-sensitive open strings of at most 64 UTF-8 bytes. `hasOrganizationRecord=true` requires an `app.certified.actor.organization/self` record, while `false` matches its absence regardless of profile presence.

Listings sort by `(createdAt, uri)` in the requested direction, defaulting to descending. Pages default to 25 entries and accept limits from 1 through 100. The opaque cursor is bound to `sortDirection`; reuse the same filters when continuing a listing. The response omits `cursor` after the final page. Unknown parameters, repeated scalar parameters, malformed filters, out-of-range limits, and invalid or direction-mismatched cursors return `InvalidRequest`.

## Work-scope tag queries

Both queries are public and require no authentication. Lookup uses the exact record AT-URI and returns `RecordNotFound` when that URI is not indexed:

```text
/xrpc/org.hypercerts.workscope.getWorkscopeTag?uri=at%3A%2F%2Fdid%3Aweb%3Apublisher.example%2Forg.hypercerts.workscope.tag%2F3jzfcijpj2z2a
```

Listing accepts repeated, unbracketed `authors` DID parameters with OR matching (up to 100 values), `sortDirection=asc|desc` (default `desc`), and `limit=1..100` (default `25`). Results use stable timestamp-and-URI order: a valid zoned record `createdAt`, then the index timestamp, then the row creation timestamp. Pass the opaque response cursor unchanged with the same filters and direction to fetch the next page. Each result includes the unchanged record and a hydrated publisher actor; a missing `indexedAt`, profile, or organization sidecar is `null`, while query/hydration failures are returned as errors. Parent and other record references are not expanded.

The handlers require the PostgreSQL HappyView records backend. The shared module registers the tag record Lexicon for backfill; the workscope-tags module registers both query Lexicons and generated Lua scripts. `pnpm build` refreshes the checked-in handler bundles. Installing assets with `pnpm install:api` contacts a HappyView service; use it only with an explicitly approved target and token.


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

## Local validation and HTTP coverage

See [CONTRIBUTING.md](../CONTRIBUTING.md) for local validation commands, HTTP test prerequisites and safety boundaries, endpoint coverage, and task-owned resource cleanup.

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

HTTP runtime coverage and shared runner requirements are documented in [CONTRIBUTING.md](../CONTRIBUTING.md).

HTTP suites live in `api/tests/http` and call the installed activity, collection, funding (`org.hypercerts.funding.getReceipt`, `org.hypercerts.funding.listReceipts`), badge-definition (`app.certified.badge.getBadgeDefinition`, `app.certified.badge.listBadgeDefinitions`), badge-query, acknowledgement (`org.hypercerts.context.getAcknowledgement`, `org.hypercerts.context.listAcknowledgements`), profile, organization, contributor-information (`org.hypercerts.claim.getContributorInformation`, `org.hypercerts.claim.listContributorInformation`), contribution, context attachment and evaluation, vocabulary-tag, graph, and location XRPC endpoints. `pnpm test:http` discovers `*.http.test.js` suites and fixture modules named `*.fixture.js`, then creates a random Compose project with loopback-only dynamic ports, PostgreSQL data on tmpfs, and a task-owned default bridge network. Bridge networking permits container egress. HappyView receives loopback placeholder upstream URLs and proxy variables pointing to `127.0.0.1:9`; these are application-level settings, not network-hard egress isolation. The installer and HTTP suites target only the task-owned loopback service. The runner installs this checkout's manifest, seeds shared and HTTP fixtures, runs the suites, and tears down only that generated Compose project and its temporary credentials. Locally, Compose uses `--pull never`; missing cached images fail before service startup.

The HTTP gate fails when it discovers zero suites, executes zero `node:test` cases, or runs only skipped cases. These checks cover real HTTP behavior against PostgreSQL, not just Lua handlers with a fake database. Funding coverage exercises record retrieval, repeated filters, and pagination. Badge-definition coverage exercises retrieval with an icon and allowed-issuer list, publisher-sidecar hydration, author and badge-type filters, createdAt/URI pagination ties, and named error responses. Contributor-information coverage exercises both endpoints: exact AT-URI retrieval with its CBOR-derived CID returned but not supplied in the request; repeated-author filtering; tied createdAt/URI pagination in both ascending and descending directions; hydrated and null author sidecars; and named `RecordNotFound` and `InvalidRequest` runtime errors. Contributor fixtures are seeded only into the task-owned disposable database.

For the pinned HappyView release, ordinary Lua `error()` exceptions are returned as HTTP 500 JSON with `error: "script_error"` and `errorType: "runtime"`; the error name appears in `message`. The negative HTTP tests assert this observed runtime behavior. They do not define an ideal public HTTP status contract or guarantee 4xx mapping for `RecordNotFound` and `InvalidRequest`.

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

The installer validates all local assets and dependencies before making admin requests, then checks installed versions before writing. By default, any conflicting declared asset stops the install before asset writes. Pass `--override` to replace only conflicting assets declared by this bundle; it does not affect undeclared assets or bypass source/dependency validation, admin authentication, or the profile resolver-setting requirements. Use `--debug` to include incoming and installed values in conflict errors, or `--help` to list the options.

`pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. Writes are not rolled back if a later asset fails.

Fixture SQL helpers require an explicit disposable loopback database opt-in. Unit tests use local fixture data and fake process/network adapters; they do not seed a database or call an external HappyView service.

## Contributor-information queries

The shared module provides two public queries for `org.hypercerts.claim.contributorInformation` records:

- `org.hypercerts.claim.getContributorInformation({ uri })` returns `{ contributorInformation }` for the exact full record AT-URI. The authority must be a DID. An unindexed URI returns `RecordNotFound`.
- `org.hypercerts.claim.listContributorInformation({ authors?, sortDirection?, limit?, cursor? })` returns `{ contributorInformation, cursor? }`. `authors` filters publisher repository DIDs (OR semantics), supplied as repeated unbracketed query keys, with at most 100 values.

Both responses use the `contributorInformationView` definition declared by `org.hypercerts.claim.getContributorInformation`: record metadata (`uri`, `cid`, nullable `indexedAt`, and publisher `did`), an `author` actor view, and the original full indexed `record`. The activity endpoint keeps its separate exact-reference contributor-information view. The older proposal snippet that omits `nullable` for `indexedAt` is stale; the accepted API design requires this field to remain present as JSON `null` when the database timestamp is null. The author contains the publisher's current Certified profile and raw organization sidecar; each is `null` when missing. The record's contributor identifier is not resolved, and referencing activities are not expanded. Operational query or required hydration failures return errors rather than empty or partial results.

Listings default to 25 records and accept limits from 1 through 100. They sort by `(createdAt, uri)` in descending order unless `sortDirection` is `asc`; cursors are opaque and direction-bound. Keep filters and direction unchanged when continuing a page. The `cursor` property is omitted when there is no next page. A singular `RecordNotFound` means HappyView has no indexed row at that URI; it does not prove the record is absent or deleted from its PDS.

### Operator notes

Both queries require the HappyView PostgreSQL backend, including the profile and organization lookups used to hydrate publishers. A missing sidecar is normal and returned as `null`; a backend or lookup failure is an endpoint error. Build and validate locally with `pnpm build:lua` and `pnpm check`. Register these assets through the existing `pnpm install:api` workflow only after confirming the intended HappyView target and credentials; the installer performs external admin writes.

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
