# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` contains record schemas and query Lexicons used as shared view types; it contains no Lua endpoint scripts. The `workscope-tags` module adds public lookup and listing queries for indexed `org.hypercerts.workscope.tag` records.

## Work-scope tag queries

Both queries are public and require no authentication. Lookup uses the exact record AT-URI and returns `RecordNotFound` when that URI is not indexed:

```text
/xrpc/org.hypercerts.workscope.getWorkscopeTag?uri=at%3A%2F%2Fdid%3Aweb%3Apublisher.example%2Forg.hypercerts.workscope.tag%2F3jzfcijpj2z2a
```

Listing accepts repeated, unbracketed `authors` DID parameters with OR matching (up to 100 values), `sortDirection=asc|desc` (default `desc`), and `limit=1..100` (default `25`). Results use `(createdAt, uri)` order; pass the opaque response cursor unchanged with the same filters and direction to fetch the next page. Each result includes the unchanged record and a hydrated publisher actor; a missing profile or organization sidecar is `null`, while query/hydration failures are returned as errors. Parent and other record references are not expanded.

The handlers require the PostgreSQL HappyView records backend. The shared module registers the tag record Lexicon for backfill; the workscope-tags module registers both query Lexicons and generated Lua scripts. `pnpm build` refreshes the checked-in handler bundles. Installing assets with `pnpm install:api` contacts a HappyView service; use it only with an explicitly approved target and token.

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
