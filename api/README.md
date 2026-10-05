# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` contains record schemas and query Lexicons used as shared view types; it contains no Lua endpoint scripts. The `workscope-tags` module adds public lookup and listing queries for indexed `org.hypercerts.workscope.tag` records.

## Work-scope tag queries

Both queries are public and require no authentication. Lookup uses the exact record AT-URI and returns `RecordNotFound` when that URI is not indexed:

```text
/xrpc/org.hypercerts.workscope.getWorkscopeTag?uri=at%3A%2F%2Fdid%3Aweb%3Apublisher.example%2Forg.hypercerts.workscope.tag%2F3jzfcijpj2z2a
```

Listing accepts repeated, unbracketed `authors` DID parameters with OR matching (up to 100 values), `sortDirection=asc|desc` (default `desc`), and `limit=1..100` (default `25`). Results use stable timestamp-and-URI order: a valid zoned record `createdAt`, then the index timestamp, then the row creation timestamp. Pass the opaque response cursor unchanged with the same filters and direction to fetch the next page. Each result includes the unchanged record and a hydrated publisher actor; a missing `indexedAt`, profile, or organization sidecar is `null`, while query/hydration failures are returned as errors. Parent and other record references are not expanded.

The handlers require the PostgreSQL HappyView records backend. The shared module registers the tag record Lexicon for backfill; the workscope-tags module registers both query Lexicons and generated Lua scripts. `pnpm build` refreshes the checked-in handler bundles. Installing assets with `pnpm install:api` contacts a HappyView service; use it only with an explicitly approved target and token.

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

HTTP suites live in `api/tests/http` and exercise all installed funding-receipt (`org.hypercerts.funding.getReceipt`, `org.hypercerts.funding.listReceipts`), badge-definition (`app.certified.badge.getBadgeDefinition`, `app.certified.badge.listBadgeDefinitions`), and work-scope-tag (`org.hypercerts.workscope.getWorkscopeTag`, `org.hypercerts.workscope.listWorkscopeTags`) endpoints. `pnpm test:http` discovers `*.http.test.js` suites and fixture modules named `*.fixture.js`, then creates a random Compose project with loopback-only dynamic ports, PostgreSQL data on tmpfs, and a task-owned default bridge network. Bridge networking permits container egress. HappyView receives loopback placeholder upstream URLs and proxy variables pointing to `127.0.0.1:9`; these are application-level settings, not network-hard egress isolation. The installer and HTTP suites target only the task-owned loopback service. The runner installs this checkout's manifest, seeds shared and HTTP fixtures, runs the suites, and tears down only that generated Compose project and its temporary credentials. Locally, Compose uses `--pull never`; missing cached images fail before service startup.

The HTTP gate fails when it discovers zero suites, executes zero `node:test` cases, or runs only skipped cases. These checks cover real HTTP behavior against PostgreSQL, not just Lua handlers with a fake database. Funding coverage exercises record retrieval, repeated filters, and pagination. Badge-definition coverage exercises retrieval with an icon and allowed-issuer list, publisher-sidecar hydration, author and badge-type filters, createdAt/URI pagination ties, and named error responses. Work-scope-tag coverage exercises exact-URI retrieval with a hardcoded CBOR-derived CID, hydrated and absent publisher sidecars, repeated-author filtering with an empty-result negative, tied pagination in both directions, and named error responses. All capability fixture rows use CBOR-derived CIDs and are seeded only into the task-owned disposable database.

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
