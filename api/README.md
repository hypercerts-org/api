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
pnpm test:unit
pnpm check
pnpm build
PSQL_PATH="$(command -v psql)" pnpm test:http
```

`pnpm test:unit` and `pnpm check` run the recursively discovered tests under `api/tests/unit`; unit tests do not require HappyView or PostgreSQL. `pnpm check` also validates generated-source freshness, JavaScript/Lua lint, and types. `pnpm build` emits only Lua handlers declared by the root and module manifests. Shared Lua files are bundled into capability handlers but are not installed independently.

`pnpm test:http` requires a local Docker Compose daemon, `psql`, and the pinned PostgreSQL and HappyView images already present in the local image cache. The local runner never pulls images. The CI workflow explicitly pulls only the two digest-pinned test images before running the same command. Set `PSQL_PATH` to the absolute path returned by `command -v psql`.

## HTTP runtime tests

HTTP suites live in `api/tests/http` and call the two funding and two badge-definition XRPC endpoints installed from the current checkout. `pnpm test:http` discovers `*.http.test.js` suites and fixture modules named `*.fixture.js`, then creates a random Compose project with loopback-only dynamic ports, PostgreSQL data on tmpfs, and a task-owned default bridge network. Bridge networking permits container egress. HappyView receives loopback placeholder upstream URLs and proxy variables pointing to `127.0.0.1:9`; these are application-level settings, not network-hard egress isolation. The installer and HTTP suites target only the task-owned loopback service. The runner installs this checkout's manifest, seeds shared and HTTP fixtures, runs the suites, and tears down only that generated Compose project and its temporary credentials. Locally, Compose uses `--pull never`; missing cached images fail before service startup.

The HTTP gate fails when it discovers zero suites, executes zero `node:test` cases, or runs only skipped cases. These checks cover real HTTP behavior against PostgreSQL, not just Lua handlers with a fake database. Funding coverage exercises record retrieval, repeated filters, and pagination. Badge-definition coverage exercises retrieval with an icon and allowed-issuer list, publisher-sidecar hydration, author and badge-type filters, createdAt/URI pagination ties, and named error responses. Badge fixtures use CBOR-derived record CIDs and are seeded only into the task-owned disposable database.

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

The reusable installer validates every local asset and dependency before making admin requests. `pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. It does not roll back writes if a later asset fails.

Fixture SQL helpers require an explicit disposable loopback database opt-in. Unit tests use local fixture data and fake process/network adapters; they do not seed a database or call an external HappyView service.
