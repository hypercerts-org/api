# Hypercerts API workspace

This repository builds and installs Hypercerts API modules for HappyView. `api/manifest.json` is authoritative for included modules. The endpoint explorer in `docs/` is generated from committed Lexicon snapshots; `pnpm docs:sync` refreshes its index, snapshots, OpenAPI reference, and coverage report from local API sources and pinned dependencies. It does not contact remote Lexicons or HappyView.

## Repository map

- `api/` — installer, manifests, Lua handlers, shared tooling, and unit/HTTP tests.
- `docs/` — endpoint explorer, generated OpenAPI reference, Lexicon snapshots, coverage report, and explorer tests.
- `.changeset/` — release notes and versioning metadata.
- `.github/` — GitHub workflows.
- `.agents/` — repository-specific agent instructions and skills.

## Checks

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` validates generated handlers, lint, types, API unit tests, and endpoint explorer tests, including read-only docs freshness checks. `pnpm build` refreshes declared Lua bundles and builds the endpoint explorer. These commands do not contact or install to HappyView.

For installed-endpoint HTTP tests, run:

```sh
PSQL_PATH="$(command -v psql)" pnpm test:http
```

This requires Docker Compose, `psql`, and the pinned PostgreSQL and HappyView images already cached locally. Tests use a task-owned disposable project and database; the Compose bridge network permits egress and is not network-level isolation. See [CONTRIBUTING.md](CONTRIBUTING.md) for test requirements and safety details.

## Install to HappyView

Install workspace dependencies first, then run the installer from `api/` with an approved HappyView URL and scoped admin token. For bundles that include `app.certified.actor.getProfile`, also set `HYPERCERTS_HANDLE_RESOLVER_URL` to an HTTPS origin without credentials, path, query, or fragment:

```sh
cd api
HYPERCERTS_HANDLE_RESOLVER_URL='https://resolver.example' \
HAPPYVIEW_BASE_URL='https://your-happyview.example' \
HAPPYVIEW_ADMIN_TOKEN='<scoped-admin-token>' \
pnpm install:api
```

The admin token needs `script-variables:read`; if the resolver setting is absent and the installer must create it, it also needs `script-variables:create`. Conflicting assets stop installation by default; `--override` opts into replacing declared conflicts. The installer sends admin requests and uploads assets, and writes are not rolled back if a later asset fails. Run it only against an explicitly approved target with approved credentials. For tagged-release installation and resolver-setting behavior, see [api/README.md](api/README.md#install-a-released-api-bundle).
