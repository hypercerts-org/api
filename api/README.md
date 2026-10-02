# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` contains record schemas and query Lexicons used as shared view types; it contains no Lua endpoint scripts. A foundation-only install therefore does not implement those queries.

## Local checks

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

These checks are offline and do not require a HappyView instance or database. `pnpm check` runs generated-source freshness, JavaScript/Lua lint, typechecking, and unit tests. `pnpm build` emits only Lua handlers declared by the root and module manifests. Shared Lua files are bundled into capability handlers but are not installed independently.

## Runtime contracts

Runtime contracts run in the GitHub Actions workflow against the code checked out for the pull request. The job generates temporary credentials, starts the pinned HappyView and PostgreSQL Compose services with PostgreSQL data on tmpfs, waits for HappyView health, bootstraps a permission-scoped admin key, installs the checked-out manifest, and seeds deterministic fixtures. It then runs the `api/tests/contracts/*.contract.test.js` files present in that checkout. If there are no endpoint contract files, the workflow reports that and skips only the endpoint-test step. A present `location-bad-dates.contract.test.js` runs after routine suites with its isolated fixtures seeded immediately beforehand. The job collects Compose logs on failure and removes the Compose project and generated environment file in an unconditional cleanup step.

The workflow installs `psql` at `/usr/bin/psql`; no local HappyView/PostgreSQL runtime command is provided. Local `pnpm check` and `pnpm build` remain offline. The Compose config points Jetstream, relay, and PLC at a refused loopback port and sets HTTP proxy variables to a refused loopback proxy. This blocks those configured destinations and proxy-aware HTTP requests, but it is not a host-level egress firewall: clients that ignore proxy variables can still reach external services. The runtime check does not claim that all background activity or external traffic is disabled.

The reusable installer validates every local asset and dependency before making admin requests. `pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. It does not roll back writes if a later asset fails.

Fixture SQL helpers require an explicit disposable loopback database opt-in. Unit tests use local fixture data and fake process/network adapters; they do not seed a database or call an external HappyView service.
