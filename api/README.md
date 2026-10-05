# HappyView API toolkit and feature queries

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, offline fixture/test utilities, and the feature-query module. The `modules/shared/manifest.json` contains record schemas and shared view definitions; `modules/features/manifest.json` registers the feature query Lexicons and Lua handlers.

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

HTTP suites live in `api/tests/http` and exercise the funding, badge-definition, and feature-query XRPC endpoints installed from the current checkout. `pnpm test:http` discovers `*.http.test.js` suites and fixture modules named `*.fixture.js`, then creates a random Compose project with loopback-only dynamic ports, PostgreSQL data on tmpfs, and a task-owned default bridge network. Bridge networking permits container egress. HappyView receives loopback placeholder upstream URLs and proxy variables pointing to `127.0.0.1:9`; these are application-level settings, not network-hard egress isolation. The installer and HTTP suites target only the task-owned loopback service. The runner installs this checkout's manifest, seeds shared and HTTP fixtures, runs the suites, and tears down only that generated Compose project and its temporary credentials. Locally, Compose uses `--pull never`; missing cached images fail before service startup.

The HTTP gate fails when it discovers zero suites, executes zero `node:test` cases, or runs only skipped cases. These checks cover real HTTP behavior against PostgreSQL, not just Lua handlers with a fake database. Funding coverage exercises record retrieval, repeated filters, and pagination. Badge-definition coverage exercises retrieval with an icon and allowed-issuer list, publisher-sidecar hydration, author and badge-type filters, createdAt/URI pagination ties, and named error responses. Feature coverage exercises exact retrieval and author hydration, list filters and sidecars, tied createdAt/URI pagination, and named errors. Fixtures use CBOR-derived record CIDs and are seeded only into the task-owned disposable database.

For the pinned HappyView release, ordinary Lua `error()` exceptions are returned as HTTP 500 JSON with `error: "script_error"` and `errorType: "runtime"`; the error name appears in `message`. The negative HTTP tests assert this observed runtime behavior. They do not define an ideal public HTTP status contract or guarantee 4xx mapping for `RecordNotFound` and `InvalidRequest`.

## Feature query API

Both feature queries are public and require no authentication. The aggregate manifest includes the feature module and its validation Lexicons; the handlers read indexed records from PostgreSQL `happyview_records`.

`org.hypercerts.entity.getFeature` accepts the exact feature record AT-URI, including its DID authority and record key. It returns `InvalidRequest` for malformed or non-feature URIs and `RecordNotFound` when that exact URI is not indexed. The `FeatureView` preserves the indexed record and hydrates only the author's profile and organization sidecar; either actor record may be null, and feature locations, tags, and `sameAs` references remain unexpanded.

`org.hypercerts.entity.listFeatures` accepts repeated, unbracketed `authors` and `types` query keys, with at most 100 values per array. Different filters combine with AND, while values within either array combine with OR. Authors are repository-owner DIDs; types are exact, case-sensitive open strings of at most 64 UTF-8 bytes. `hasOrganizationRecord=true` requires an `app.certified.actor.organization/self` record, while `false` matches its absence regardless of profile presence.

Listings sort by `(createdAt, uri)` in the requested direction, defaulting to descending. Pages default to 25 entries and accept limits from 1 through 100. The opaque cursor is bound to `sortDirection`; reuse the same filters when continuing a listing. The response omits `cursor` after the final page. Unknown parameters, repeated scalar parameters, malformed filters, out-of-range limits, and invalid or direction-mismatched cursors return `InvalidRequest`.

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
