# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` declares shared record/view Lexicons; `modules/context-measurements/manifest.json` registers the public measurement query handlers.

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
pnpm check
pnpm build
```

These checks are offline and do not require a HappyView instance or database. `pnpm check` runs generated-source freshness, JavaScript/Lua lint, typechecking, and unit tests. `pnpm build` emits only Lua handlers declared by the root and module manifests. Shared Lua files are bundled into capability handlers but are not installed independently.

The reusable installer validates every local asset and dependency before making admin requests. `pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. It does not roll back writes if a later asset fails.

Fixture SQL helpers require an explicit disposable loopback database opt-in. Unit tests use local fixture data and fake process/network adapters; they do not seed a database or call an external HappyView service.
