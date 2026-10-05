# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, offline fixtures/tests, and a standalone Certified EVM-link query module. The `modules/shared/manifest.json` contains shared record schemas and view Lexicons; the `modules/evm-links/manifest.json` installs `app.certified.link.getEvmLink` and `app.certified.link.listEvmLinks` with their handlers.

## EVM-link queries

Both endpoints are public and read only `app.certified.link.evm` records. `getEvmLink` requires the exact record AT-URI with a DID authority and returns `RecordNotFound` when it is not indexed. `listEvmLinks` can list globally or accept repeated unbracketed `actors` and `addresses` parameters (up to 100 values each); values within a filter use OR, while both filters combine with AND. Addresses must be `0x` followed by 40 hexadecimal digits and are compared case-insensitively; returned records keep their original address and proof. Lists default to 25 records, cap at 100, sort by `(createdAt, uri)` descending by default, and use a direction-bound opaque cursor. Actor profile and organization sidecars are hydrated when present and returned as null when missing. No wallet balances, transactions, chain data, or legacy Gainforest records are queried.

The root manifest declares the EVM-link record Lexicon and handlers, so `pnpm build` and `pnpm check` cover the standalone module. `pnpm install:api` installs the declared assets and starts backfill for the record collection; it contacts HappyView and requires an explicitly approved target and token.

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

HTTP suites live in `api/tests/http` and call the two funding, two badge-definition, and two EVM-link XRPC endpoints installed from the current checkout. `pnpm test:http` discovers `*.http.test.js` suites and fixture modules named `*.fixture.js`, then creates a random Compose project with loopback-only dynamic ports, PostgreSQL data on tmpfs, and a task-owned default bridge network. Bridge networking permits container egress. HappyView receives loopback placeholder upstream URLs and proxy variables pointing to `127.0.0.1:9`; these are application-level settings, not network-hard egress isolation. The installer and HTTP suites target only the task-owned loopback service. The runner installs this checkout's manifest, seeds shared and HTTP fixtures, runs the suites, and tears down only that generated Compose project and its temporary credentials. Locally, Compose uses `--pull never`; missing cached images fail before service startup.

The HTTP gate fails when it discovers zero suites, executes zero `node:test` cases, or runs only skipped cases. These checks cover real HTTP behavior against PostgreSQL, not just Lua handlers with a fake database. Funding coverage exercises record retrieval, repeated filters, and pagination. Badge-definition coverage exercises retrieval with an icon and allowed-issuer list, publisher-sidecar hydration, author and badge-type filters, createdAt/URI pagination ties, and named error responses. EVM-link coverage exercises `getEvmLink` CID/record retrieval, combined actor/address filters, tied pagination in ascending and descending order, nullable sidecar hydration, and named error responses. Badge and EVM-link fixtures use CBOR-derived record CIDs and are seeded only into the task-owned disposable database.

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
