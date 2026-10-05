# HappyView API toolkit foundation

This package contains the shared API installer and tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and the public `org.hypercerts.claim.getRights` and `org.hypercerts.claim.listRights` query handlers. The rights handlers are registered in `modules/rights/manifest.json`; the shared module registers their record and actor-view dependencies.

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
- `RightsView.indexedAt` is required but nullable to match indexed rows. Older proposal prose that describes it as non-nullable is stale.
- Rights listing uses PostgreSQL 16+ `pg_input_is_valid` timestamp validation; the canonical HappyView deployment and test configurations default to PostgreSQL 17.

The shared module registers the pinned rights-record Lexicon with backfill enabled, so an approved install can index existing rights records.

The reusable installer validates every local asset and dependency before making admin requests. `pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. It does not roll back writes if a later asset fails.
