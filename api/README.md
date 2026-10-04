# HappyView API toolkit and feature queries

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, offline fixture/test utilities, and the feature-query module. The `modules/shared/manifest.json` contains record schemas and shared view definitions; `modules/features/manifest.json` registers the feature query Lexicons and Lua handlers.

## Local checks

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

These checks are offline and do not require a HappyView instance or database. `pnpm check` runs generated-source freshness, JavaScript/Lua lint, typechecking, and unit tests. `pnpm build` emits Lua handlers declared by the aggregate and module manifests. Shared Lua files are bundled into handlers but are not installed independently.

The reusable installer validates every local asset and dependency before making admin requests. `pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. It does not roll back writes if a later asset fails.

Fixture SQL helpers require an explicit disposable loopback database opt-in. Unit tests use local fixture data and fake process/network adapters; they do not seed a database or call an external HappyView service.

## Feature query API

Both feature queries are public and require no authentication. The aggregate manifest includes the feature module and its validation Lexicons; the handlers read indexed records from PostgreSQL `happyview_records`.

`org.hypercerts.entity.getFeature` accepts the exact feature record AT-URI, including its DID authority and record key. It returns `InvalidRequest` for malformed or non-feature URIs and `RecordNotFound` when that exact URI is not indexed. The `FeatureView` preserves the indexed record and hydrates only the author's profile and organization sidecar; either actor record may be null, and feature locations, tags, and `sameAs` references remain unexpanded.

`org.hypercerts.entity.listFeatures` accepts repeated, unbracketed `authors` and `types` query keys, with at most 100 values per array. Different filters combine with AND, while values within either array combine with OR. Authors are repository-owner DIDs; types are exact, case-sensitive open strings of at most 64 UTF-8 bytes. `hasOrganizationRecord=true` requires an `app.certified.actor.organization/self` record, while `false` matches its absence regardless of profile presence.

Listings sort by `(createdAt, uri)` in the requested direction, defaulting to descending. Pages default to 25 entries and accept limits from 1 through 100. The opaque cursor is bound to `sortDirection`; reuse the same filters when continuing a listing. The response omits `cursor` after the final page. Unknown parameters, repeated scalar parameters, malformed filters, out-of-range limits, and invalid or direction-mismatched cursors return `InvalidRequest`.

`pnpm build` regenerates the feature handlers in `lua/endpoints/` from their declared `lua/src/` sources and shared projection helpers. Installing the aggregate with `pnpm install:api` contacts the configured HappyView service and uploads assets; it is an external operation and must only be run with an explicitly approved target and token.
