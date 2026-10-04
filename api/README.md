# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The shared module registers record schemas and common views; the badge-queries module installs five public badge query Lexicons and their Lua handlers.

## Local checks

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

These checks are offline and do not require a HappyView instance or database. `pnpm check` runs generated-source freshness, JavaScript/Lua lint, typechecking, and unit tests. `pnpm build` emits only Lua handlers declared by the root and module manifests. Shared Lua files are bundled into capability handlers but are not installed independently.

The reusable installer validates every local asset and dependency before making admin requests. `pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. It does not roll back writes if a later asset fails.

Fixture SQL helpers require an explicit disposable loopback database opt-in. Unit tests use local fixture data and fake process/network adapters; they do not seed a database or call an external HappyView service.

## Badge query endpoints

`modules/badge-queries/manifest.json` registers `searchBadgeDefinitions`, `getBadgeAward`, `listBadgeAwards`, `getBadgeResponse`, and `listBadgeResponses`. They read indexed PostgreSQL records and require no caller authentication. The shared module registers the badge definition, award, and response record schemas with backfill enabled; the query module does not add or migrate database tables.

Definition search trims the required `search` value and matches it as a case-insensitive literal substring in `title` or `description`; blank text is unrestricted. `authors` and `badgeTypes` are repeated query parameters with OR within each filter. Award-list filters combine with AND, while values in each array use OR. `subjects` accepts only DIDs or full record AT-URIs with valid collection NSIDs and matches only the corresponding DID or strong-reference URI variant; invalid entries reject the request. Badge-type filtering and embedded `badge` data use the exact definition URI and CID pinned by the award, while `badgeUris` compares only the URI.

Award views keep each award distinct and include `responseStatus` plus `recipientResponse`. The legitimate recipient is the subject DID or the DID in a record subject AT-URI. Only that repository's accepted or rejected response with the exact award URI and CID is eligible; unknown open response values remain visible in raw response queries but do not replace a prior eligible response. The latest eligible response is selected by index order and URI, not client `createdAt`. Missing exact definition versions remain visible as `badge: null`; absent eligible responses are `unanswered`. Raw response lookups and listings preserve history, include non-recipient records, and do not expand the referenced award. `listBadgeResponses` filters by award URI only.

All list endpoints use a default page size of 25, accept limits from 1 to 100, sort by `(createdAt, uri)` descending by default, and return an opaque cursor only when another page exists. Keep filters and sort direction unchanged when following a cursor. Repeated array parameters are limited to 100 supplied values; unknown parameters and repeated scalar parameters are rejected.
