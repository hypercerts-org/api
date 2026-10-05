# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, offline fixtures/tests, and a standalone Certified EVM-link query module. The `modules/shared/manifest.json` contains shared record schemas and view Lexicons; the `modules/evm-links/manifest.json` installs `app.certified.link.getEvmLink` and `app.certified.link.listEvmLinks` with their handlers.

## EVM-link queries

Both endpoints are public and read only `app.certified.link.evm` records. `getEvmLink` requires the exact record AT-URI with a DID authority and returns `RecordNotFound` when it is not indexed. `listEvmLinks` can list globally or accept repeated unbracketed `actors` and `addresses` parameters (up to 100 values each); values within a filter use OR, while both filters combine with AND. Addresses must be `0x` followed by 40 hexadecimal digits and are compared case-insensitively; returned records keep their original address and proof. Lists default to 25 records, cap at 100, sort by `(createdAt, uri)` descending by default, and use a direction-bound opaque cursor. Actor profile and organization sidecars are hydrated when present and returned as null when missing. No wallet balances, transactions, chain data, or legacy Gainforest records are queried.

The root manifest declares the EVM-link record Lexicon and handlers, so `pnpm build` and `pnpm check` cover the standalone module. `pnpm install:api` installs the declared assets and starts backfill for the record collection; it contacts HappyView and requires an explicitly approved target and token.

EVM-link HTTP coverage exercises `getEvmLink` record retrieval, combined actor/address filters, tied pagination in both directions, nullable sidecar hydration, and named errors. Its fixtures use CBOR-derived record CIDs. See the root [CONTRIBUTING.md](../CONTRIBUTING.md) for local validation commands and HTTP runtime requirements.

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
