# HappyView API toolkit foundation

This package contains the shared API installer and tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and the public `org.hypercerts.claim.getRights` and `org.hypercerts.claim.listRights` query handlers. The rights handlers are registered in `modules/rights/manifest.json`; the shared module registers their record and actor-view dependencies.

## Local checks

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

These checks are offline and do not require a HappyView instance or database. `pnpm check` runs generated-source freshness, JavaScript/Lua lint, typechecking, and unit tests. `pnpm build` emits only Lua handlers declared by the root and module manifests. Shared Lua files are bundled into capability handlers but are not installed independently.

## Rights queries

- `org.hypercerts.claim.getRights` accepts the exact rights-record AT-URI with a DID authority. An unindexed record returns `RecordNotFound`.
- `org.hypercerts.claim.listRights` accepts up to 100 repeated, unbracketed `authors` keys; values use OR. Pages default to 25 and cap at 100. Ordering uses `(createdAt, uri)`; missing or malformed record timestamps fall back to `indexed_at`, then row creation time. Cursors are opaque and bound to sort direction; a terminal page omits `cursor`.
- Both queries preserve the full indexed record and hydrate the publisher's Certified profile and raw organization sidecar. Missing author records are `null`; SQL `NULL` `indexed_at` is returned as JSON `null` without inventing a timestamp. Query or hydration failures return errors. Attachments and activities referencing rights are not expanded.
- `RightsView.indexedAt` is required but nullable to match indexed rows. Older proposal prose that describes it as non-nullable is stale.
- Rights listing uses PostgreSQL 16+ `pg_input_is_valid` timestamp validation; the canonical HappyView deployment and test configurations default to PostgreSQL 17.

The shared module registers the pinned rights-record Lexicon with backfill enabled, so an approved install can index existing rights records.

The reusable installer validates every local asset and dependency before making admin requests. `pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. It does not roll back writes if a later asset fails.

Fixture SQL helpers require an explicit disposable loopback database opt-in. Unit tests use local fixture data and fake process/network adapters; they do not seed a database or call an external HappyView service.
