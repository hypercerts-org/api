# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` contains record schemas and query Lexicons used as shared view types; it contains no Lua endpoint scripts. A foundation-only install therefore does not implement those queries.

For local development checks and HTTP runtime test requirements, see [CONTRIBUTING.md](../CONTRIBUTING.md).

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

HTTP runtime coverage and shared runner requirements are documented in [CONTRIBUTING.md](../CONTRIBUTING.md).

HTTP suites live in `api/tests/http` and call the installed activity, collection, funding (`org.hypercerts.funding.getReceipt`, `org.hypercerts.funding.listReceipts`), badge-definition (`app.certified.badge.getBadgeDefinition`, `app.certified.badge.listBadgeDefinitions`), profile, organization, contributor-information (`org.hypercerts.claim.getContributorInformation`, `org.hypercerts.claim.listContributorInformation`), context attachment and evaluation, graph, and location XRPC endpoints. `pnpm test:http` discovers `*.http.test.js` suites and fixture modules named `*.fixture.js`, then creates a random Compose project with loopback-only dynamic ports, PostgreSQL data on tmpfs, and a task-owned default bridge network. Bridge networking permits container egress. HappyView receives loopback placeholder upstream URLs and proxy variables pointing to `127.0.0.1:9`; these are application-level settings, not network-hard egress isolation. The installer and HTTP suites target only the task-owned loopback service. The runner installs this checkout's manifest, seeds shared and HTTP fixtures, runs the suites, and tears down only that generated Compose project and its temporary credentials. Locally, Compose uses `--pull never`; missing cached images fail before service startup.

The HTTP gate fails when it discovers zero suites, executes zero `node:test` cases, or runs only skipped cases. These checks cover real HTTP behavior against PostgreSQL, not just Lua handlers with a fake database. Funding coverage exercises record retrieval, repeated filters, and pagination. Badge-definition coverage exercises retrieval with an icon and allowed-issuer list, publisher-sidecar hydration, author and badge-type filters, createdAt/URI pagination ties, and named error responses. Contributor-information coverage exercises both endpoints: exact AT-URI retrieval with its CBOR-derived CID returned but not supplied in the request; repeated-author filtering; tied createdAt/URI pagination in both ascending and descending directions; hydrated and null author sidecars; and named `RecordNotFound` and `InvalidRequest` runtime errors. Contributor fixtures are seeded only into the task-owned disposable database.

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

## Contributor-information queries

The shared module provides two public queries for `org.hypercerts.claim.contributorInformation` records:

- `org.hypercerts.claim.getContributorInformation({ uri })` returns `{ contributorInformation }` for the exact full record AT-URI. The authority must be a DID. An unindexed URI returns `RecordNotFound`.
- `org.hypercerts.claim.listContributorInformation({ authors?, sortDirection?, limit?, cursor? })` returns `{ contributorInformation, cursor? }`. `authors` filters publisher repository DIDs (OR semantics), supplied as repeated unbracketed query keys, with at most 100 values.

Both responses use the `contributorInformationView` definition declared by `org.hypercerts.claim.getContributorInformation`: record metadata (`uri`, `cid`, nullable `indexedAt`, and publisher `did`), an `author` actor view, and the original full indexed `record`. The activity endpoint keeps its separate exact-reference contributor-information view. The older proposal snippet that omits `nullable` for `indexedAt` is stale; the accepted API design requires this field to remain present as JSON `null` when the database timestamp is null. The author contains the publisher's current Certified profile and raw organization sidecar; each is `null` when missing. The record's contributor identifier is not resolved, and referencing activities are not expanded. Operational query or required hydration failures return errors rather than empty or partial results.

Listings default to 25 records and accept limits from 1 through 100. They sort by `(createdAt, uri)` in descending order unless `sortDirection` is `asc`; cursors are opaque and direction-bound. Keep filters and direction unchanged when continuing a page. The `cursor` property is omitted when there is no next page. A singular `RecordNotFound` means HappyView has no indexed row at that URI; it does not prove the record is absent or deleted from its PDS.

### Operator notes

Both queries require the HappyView PostgreSQL backend, including the profile and organization lookups used to hydrate publishers. A missing sidecar is normal and returned as `null`; a backend or lookup failure is an endpoint error. Build and validate locally with `pnpm build:lua` and `pnpm check`. Register these assets through the existing `pnpm install:api` workflow only after confirming the intended HappyView target and credentials; the installer performs external admin writes.
