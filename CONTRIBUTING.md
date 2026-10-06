# Contributing

## Set up and validate

Use the repository-pinned pnpm version. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test:unit
pnpm check
pnpm build
```

`pnpm test:unit` runs the discovered tests under `api/tests/unit`; unit tests use local fixtures and fake process/network adapters, and do not seed a database or contact HappyView. `pnpm check` also checks generated-source freshness, JavaScript and Lua lint, types, and endpoint tests. `pnpm build` emits Lua handlers declared by the root and module manifests. Shared Lua files are bundled into capability handlers rather than installed independently.

## HTTP runtime tests

`pnpm test:http` runs the suites in `api/tests/http` against the activity, badge-definition, badge-query, acknowledgement, collection, context attachment and evaluation, contributor-information, funding, location, profile, organization, work-scope-tag, vocabulary-tag, graph, and contribution query XRPC endpoints installed from this checkout. These tests exercise real HTTP behavior against PostgreSQL, not only Lua handlers with a fake database.

The local runner requires a local Docker Compose daemon, `psql`, and the pinned PostgreSQL and HappyView images already cached locally. Set `PSQL_PATH` to the absolute path of a trusted `psql` executable:

```sh
PSQL_PATH="$(command -v psql)" pnpm test:http
```

Locally, Compose uses `--pull never`; if a pinned image is missing, the test fails before service startup. CI explicitly pulls the two digest-pinned test images before running the same command.

The runner discovers `*.http.test.js` suites and `*.fixture.js` fixture modules, then creates a random Compose project with loopback-only dynamic ports, PostgreSQL data on tmpfs, and a task-owned default bridge network. It installs this checkout's manifest, seeds shared and HTTP fixtures, runs the suites, and tears down only that generated Compose project and its temporary credentials. Fixtures are seeded only into the task-owned disposable database; fixture SQL helpers require an explicit disposable loopback database opt-in.

The bridge network permits container egress. HappyView receives loopback placeholder upstream URLs and proxy variables pointing to `127.0.0.1:9`; these are application-level settings, not network-level egress isolation. The installer and HTTP suites target only the task-owned loopback service.

The HTTP gate fails if it discovers no suites, executes no `node:test` cases, or runs only skipped cases. Current coverage includes:

- Funding record retrieval, repeated filters, and pagination.
- Badge-definition retrieval with an icon and allowed-issuer list, publisher-sidecar hydration, author and badge-type filters, `createdAt`/URI pagination ties, and named error responses.
- Contributor-information retrieval by exact AT-URI and listing with repeated-author filters, cursor pagination, hydrated and missing author sidecars, and named runtime errors.
- Work-scope-tag exact-URI retrieval, repeated-author filtering with an empty-result case, hydrated and null publisher sidecars, middle-position `indexedAt` fallback, tied pagination in both directions, and named error responses.
- Acknowledgement exact retrieval and full-record preservation, hydrated and absent publisher sidecars, repeated author/subject filters, ascending and descending pagination across timestamp ties, and named errors.
- Badge-query baseline-aware definition feeds and discriminating filters, exact-version award/response lookups, recipient status, raw response history, bidirectional tied pagination, nullable sidecars, and named runtime errors.
- Profile and organization queries across all four endpoints for each record type, including batch null results, profile-sidecar hydration, filters, `createdAt`/URI pagination ties, and named errors.
- Vocabulary-tag exact-URI retrieval, repeated-author filtering and no-match behavior, hydrated and nullable sidecars, bidirectional pagination ties, unsupported-search rejection, and named errors.
- Context attachment and evaluation retrieval with publisher/evaluator sidecar hydration, list filters, pagination across tied `createdAt` values, and named runtime errors.
- Activity retrieval with contributor-sidecar hydration, author/organization/contributor/URI filters, tied timestamp pagination, and literal wildcard search.
- Collection retrieval with CBOR-derived CIDs, location/tag projections, author, organization, item and tag filters, title/shortDescription search, `createdAt`/URI pagination ties, and source-order item pagination with exact-version resolution.
- Graph actor/entity lookups and lists, tied-key pagination, nullable profile/organization sidecars, entity target resolution, and the global recent-follows `before` filter.
- Contribution exact-record retrieval, repeated publisher filters, tied ascending/descending cursor pagination, nullable publisher sidecars, and named errors.
- Badge and contribution fixtures with CBOR-derived record CIDs; contribution DIDs are distinct from baseline fixture identities.
- Location retrieval with nullable sidecars, repeated author/URI/location-type filters, unsupported-search errors, tied pagination in both directions, malformed/absent `createdAt` handling, and named errors.
- HTTP fixtures for activity, collection, funding, badge-definition, badge-query, acknowledgement, work-scope-tag, contribution, contributor-information, actor, context attachment and evaluation, graph, location, and vocabulary-tag records use CBOR-derived CIDs.

For the pinned HappyView release, ordinary Lua `error()` exceptions return HTTP 500 JSON with `error: "script_error"` and `errorType: "runtime"`; the error name appears in `message`. Negative HTTP tests assert this observed behavior. It is not a statement of the ideal public HTTP status contract, and does not guarantee 4xx mapping for `RecordNotFound` or `InvalidRequest`.

## Operations with external effects

`pnpm install:api` sends admin requests to a HappyView instance and uploads declared assets. Run it only for an explicitly approved target with an approved token. It does not roll back writes if a later asset fails. Review the target and release notes before installing a released bundle; see [api/README.md](api/README.md).
