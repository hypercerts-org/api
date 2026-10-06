# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` contains record schemas and query Lexicons used as shared view types; it contains no Lua endpoint scripts. A foundation-only install therefore does not implement those queries. Capability modules listed in the root manifest register their endpoint Lexicons and handlers separately, including the public `org.hypercerts.claim.getRights` and `org.hypercerts.claim.listRights` queries from `modules/rights/manifest.json`.

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
