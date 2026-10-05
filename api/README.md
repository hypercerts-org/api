# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` contains record schemas and query Lexicons used as shared view types; it contains no Lua endpoint scripts. The `workscope-tags` module adds public lookup and listing queries for indexed `org.hypercerts.workscope.tag` records.

## Work-scope tag queries

Both queries are public and require no authentication. Lookup uses the exact record AT-URI and returns `RecordNotFound` when that URI is not indexed:

```text
/xrpc/org.hypercerts.workscope.getWorkscopeTag?uri=at%3A%2F%2Fdid%3Aweb%3Apublisher.example%2Forg.hypercerts.workscope.tag%2F3jzfcijpj2z2a
```

Listing accepts repeated, unbracketed `authors` DID parameters with OR matching (up to 100 values), `sortDirection=asc|desc` (default `desc`), and `limit=1..100` (default `25`). Results use stable timestamp-and-URI order: a valid zoned record `createdAt`, then the index timestamp, then the row creation timestamp. Pass the opaque response cursor unchanged with the same filters and direction to fetch the next page. Each result includes the unchanged record and a hydrated publisher actor; a missing `indexedAt`, profile, or organization sidecar is `null`, while query/hydration failures are returned as errors. Parent and other record references are not expanded.

The handlers require the PostgreSQL HappyView records backend. The shared module registers the tag record Lexicon for backfill; the workscope-tags module registers both query Lexicons and generated Lua scripts. `pnpm build` refreshes the checked-in handler bundles. Installing assets with `pnpm install:api` contacts a HappyView service; use it only with an explicitly approved target and token.

## Local validation and HTTP coverage

See [CONTRIBUTING.md](../CONTRIBUTING.md) for local validation commands, HTTP test prerequisites and safety boundaries, endpoint coverage, and task-owned resource cleanup.

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
