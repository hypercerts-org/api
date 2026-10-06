# HappyView API toolkit and query modules

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, test utilities, and independently registered capability modules. The aggregate [`manifest.json`](manifest.json) selects the modules included in this checkout; module manifests declare their assets and dependencies.

## Endpoint reference

Use the [`docs/` endpoint explorer](../docs/) and generated [OpenAPI reference](../docs/openapi.json) for endpoint names and contracts. The [coverage report](../docs/coverage.json) lists manifest-registered operations; inclusion does not imply runtime or deployment validation. See [docs/README.md](../docs/README.md) to run the explorer locally and refresh its committed reference.

## Local validation

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
PSQL_PATH="$(command -v psql)" pnpm test:http
```

`pnpm check` validates generated-source freshness, lint, types, API unit tests, and endpoint explorer tests. `pnpm build` refreshes declared Lua bundles and builds the endpoint explorer. HTTP tests require Docker Compose, `psql`, and the pinned PostgreSQL and HappyView images already cached locally. They use a task-owned disposable project and database; the Compose bridge network permits egress and is not network-level isolation. See [CONTRIBUTING.md](../CONTRIBUTING.md) for test coverage and safety details.

## Install a released API bundle

Releases version the installable API bundle in this package; they do not publish to npm or deploy to a HappyView instance. GitHub Releases and tagged source archives are the distribution channel. Choose an `@hypercerts-org/hypercerts-api@X.Y.Z` release tag, clone that snapshot, install its pinned dependencies from the repository root, then run the installer from `api/`:

```sh
git clone --depth 1 --branch '@hypercerts-org/hypercerts-api@X.Y.Z' https://github.com/hypercerts-org/api.git hypercerts-api
cd hypercerts-api
pnpm install --frozen-lockfile
cd api
HYPERCERTS_HANDLE_RESOLVER_URL='https://resolver.example' \
HAPPYVIEW_BASE_URL='https://your-happyview.example' \
HAPPYVIEW_ADMIN_TOKEN='<scoped-admin-token>' \
pnpm install:api
```

For bundles that register `app.certified.actor.getProfile`, handle lookups require `HYPERCERTS_HANDLE_RESOLVER_URL` to be an HTTPS origin without credentials, path, query, or fragment. Interactive installs prompt when it is absent; noninteractive installs must set it. The admin token needs `script-variables:read`, and `script-variables:create` if the installer must create the setting. Existing settings are retained; HappyView exposes only a masked preview, so the installer cannot verify the configured value. See [CONTRIBUTING.md](../CONTRIBUTING.md) for release-note requirements and installer safety details.
