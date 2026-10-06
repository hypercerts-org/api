# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` contains record schemas and query Lexicons used as shared view types; it contains no Lua endpoint scripts. A foundation-only install therefore does not implement those queries.

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

Location HTTP coverage and shared runner requirements are documented in [CONTRIBUTING.md](../CONTRIBUTING.md).

HTTP suites live in `api/tests/http` and call the two funding, two badge-definition, and two vocabulary-tag XRPC endpoints installed from the current checkout. `pnpm test:http` discovers `*.http.test.js` suites and fixture modules named `*.fixture.js`, then creates a random Compose project with loopback-only dynamic ports, PostgreSQL data on tmpfs, and a task-owned default bridge network. Bridge networking permits container egress. HappyView receives loopback placeholder upstream URLs and proxy variables pointing to `127.0.0.1:9`; these are application-level settings, not network-hard egress isolation. The installer and HTTP suites target only the task-owned loopback service. The runner installs this checkout's manifest, seeds shared and HTTP fixtures, runs the suites, and tears down only that generated Compose project and its temporary credentials. Locally, Compose uses `--pull never`; missing cached images fail before service startup.

The HTTP gate fails when it discovers zero suites, executes zero `node:test` cases, or runs only skipped cases. These checks cover real HTTP behavior against PostgreSQL, not just Lua handlers with a fake database. Funding coverage exercises record retrieval, repeated filters, and pagination. Badge-definition coverage exercises retrieval with an icon and allowed-issuer list, publisher-sidecar hydration, author and badge-type filters, createdAt/URI pagination ties, and named error responses. Vocabulary-tag coverage exercises exact-URI retrieval, repeated-author filtering and no-match behavior, hydrated and nullable sidecars, bidirectional pagination ties, unsupported-search rejection, and named errors. Badge fixtures use CBOR-derived record CIDs and are seeded only into the task-owned disposable database.

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

## Vocabulary tag queries

The default API bundle registers two public, unauthenticated endpoints for indexed `org.hypercerts.vocab.tag` records:

- `org.hypercerts.vocab.getVocabTag` accepts `uri=at://<did>/org.hypercerts.vocab.tag/<rkey>` and returns `{ vocabTag }`. The URI must use a DID authority and identify this exact collection. An unindexed URI returns `RecordNotFound`.
- `org.hypercerts.vocab.listVocabTags` returns `{ vocabTags, cursor? }`. Its only filter is `authors`, encoded as repeated unbracketed query keys; values are publisher DIDs combined with OR. It accepts at most 100 supplied values before deduplication.

The `getVocabTag` Lexicon owns the `vocabTagView` response definition; the list Lexicon reuses it.

For example, a listing request may contain `?authors=did%3Aplc%3A...&authors=did%3Aplc%3A...&limit=25&sortDirection=desc`. Omitting `authors` leaves the publisher dimension unrestricted; an empty-string value is invalid, not an empty-array sentinel. Unknown parameters, repeated scalar parameters, invalid DIDs, limits outside 1–100, and malformed or mismatched cursors return `InvalidRequest`.

Listings default to 25 records and descending order, with a maximum page size of 100. Results use keyset pagination over `(createdAt, uri)` in the selected direction; invalid or absent record timestamps fall back to `indexed_at`, then the stored row creation time. Cursors are opaque, bind the sort direction and normalized author filter, and do not promise a snapshot while the index changes. Keep filters and sort direction unchanged between pages. The response omits `cursor` when exhausted.

Both endpoints return the complete indexed record unchanged and hydrate the publisher's Certified profile plus raw organization sidecar. Every view includes `indexedAt`, using JSON `null` when the indexed row has no timestamp. Missing sidecars are `null`; operational query or hydration failures return `VocabTagQueryFailed`, never a partial page. Taxonomy links and external references remain unexpanded. Name, category, status, hierarchy, and text-search filters are intentionally not part of this API.

The handler and Lexicons are declared in `modules/vocab/manifest.json`, included by the root aggregate manifest, and bundled from `lua/src/` into `lua/endpoints/`. `pnpm install:api` contacts the configured HappyView admin service and writes assets; run it only with an explicitly approved instance and credentials. Offline validation does not require or contact a HappyView service.
