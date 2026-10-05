# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The shared module registers record schemas and common views; the badge-queries module installs five public badge query Lexicons and their Lua handlers.

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

HTTP suites live in `api/tests/http` and call the funding, badge-definition, and badge-query XRPC endpoints installed from the current checkout. `pnpm test:http` discovers `*.http.test.js` suites and fixture modules named `*.fixture.js`, then creates a random Compose project with loopback-only dynamic ports, PostgreSQL data on tmpfs, and a task-owned default bridge network. Bridge networking permits container egress. HappyView receives loopback placeholder upstream URLs and proxy variables pointing to `127.0.0.1:9`; these are application-level settings, not network-hard egress isolation. The installer and HTTP suites target only the task-owned loopback service. The runner installs this checkout's manifest, seeds shared and HTTP fixtures, runs the suites, and tears down only that generated Compose project and its temporary credentials. Locally, Compose uses `--pull never`; missing cached images fail before service startup.

The HTTP gate fails when it discovers zero suites, executes zero `node:test` cases, or runs only skipped cases. These checks cover real HTTP behavior against PostgreSQL, not just Lua handlers with a fake database. Funding coverage exercises record retrieval, repeated filters, and pagination. Badge-definition coverage exercises retrieval with an icon and allowed-issuer list, publisher-sidecar hydration, author and badge-type filters, createdAt/URI pagination ties, and named error responses. Badge-query coverage includes a baseline-aware global definition feed, discriminating filters, exact-version award and response retrieval, recipient status, raw response history, tied pagination in both directions, nullable sidecars, and named runtime errors. Badge fixtures use CBOR-derived record CIDs and are seeded only into the task-owned disposable database.

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

## Badge query endpoints

`modules/badge-queries/manifest.json` registers `searchBadgeDefinitions`, `getBadgeAward`, `listBadgeAwards`, `getBadgeResponse`, and `listBadgeResponses`. They read indexed PostgreSQL records and require no caller authentication. The shared module registers the badge definition, award, and response record schemas with backfill enabled; the query module does not add or migrate database tables.

Definition search trims the required `search` value and matches it as a case-insensitive literal substring in `title` or `description`; blank text is unrestricted. `authors` and `badgeTypes` are repeated query parameters with OR within each filter. Award-list filters combine with AND, while values in each array use OR. `subjects` accepts only DIDs or full record AT-URIs with valid collection NSIDs and matches only the corresponding DID or strong-reference URI variant; invalid entries reject the request. Badge-type filtering and embedded `badge` data use the exact definition URI and CID pinned by the award, while `badgeUris` compares only the URI.

Award views keep each award distinct and include `responseStatus` plus `recipientResponse`. The legitimate recipient is the subject DID or the DID in a record subject AT-URI. Only that repository's accepted or rejected response with the exact award URI and CID is eligible; unknown open response values remain visible in raw response queries but do not replace a prior eligible response. The latest eligible response is selected by index order and URI, not client `createdAt`. Missing exact definition versions remain visible as `badge: null`; absent eligible responses are `unanswered`. Raw response lookups and listings preserve history, include non-recipient records, and do not expand the referenced award. `listBadgeResponses` filters by award URI only.

All list endpoints use a default page size of 25, accept limits from 1 to 100, sort by `(createdAt, uri)` descending by default, and return an opaque cursor only when another page exists. Keep filters and sort direction unchanged when following a cursor. Repeated array parameters are limited to 100 supplied values; unknown parameters and repeated scalar parameters are rejected.
