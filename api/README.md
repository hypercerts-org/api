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

From the repository root, run:

```sh
PSQL_PATH="$(command -v psql)" pnpm test:runtime
```

This requires Docker Compose and a trusted absolute `PSQL_PATH` to a real executable `psql`. The command creates a uniquely named Compose project and test-marked database, binds HappyView and PostgreSQL only to loopback ports, stores PostgreSQL data on tmpfs, generates short-lived credentials, and removes only that project on success or failure. HappyView's pinned image runs its normal PostgreSQL migrations at startup. The command then bootstraps a permission-scoped API key in that database, installs the current branch manifest through the localhost admin API, reads every declared asset back for verification, and seeds the new database with the checked-in deterministic fixtures.

Only `api/tests/contracts/*.contract.test.js` files present on the current branch are run; helper/unit tests are not mistaken for HTTP suites. The runner prints both installed XRPC handlers and discovered HTTP suites, and fails rather than claiming endpoint coverage when handlers exist but no HTTP suite is present. Routine contract suites run first. If `location-bad-dates.contract.test.js` exists, the runner then seeds its isolated bad-date fixtures with `seed.js --bad-dates` before running that suite, so those records cannot pollute routine suite results. This foundation branch has no endpoint Lua handlers or endpoint HTTP suites, so its runtime proof is migrations, admin authentication, manifest installation/read-back, and fixture seeding—not endpoint behavior. Capability implementations and suites on other branches are not copied or merged into this branch.

Installer, database-seed, and HTTP-contract child stages each have a 120-second deadline, configurable with `HAPPYVIEW_CONTRACTS_STAGE_TIMEOUT_MS`. Manifest read-back has the same overall deadline and a 15-second per-request deadline, configurable with `HAPPYVIEW_CONTRACTS_ADMIN_REQUEST_TIMEOUT_MS`. SIGINT/SIGTERM stops the active child process group, then collects diagnostics, removes only this Compose project, and deletes its generated env file; cleanup failures are reported alongside the original failure. CI also applies a 15-minute job timeout.

HappyView 2.13.0 has no configuration switch for every background task. The Compose config points Jetstream, relay, and PLC at a refused loopback port and sets HTTP proxy variables to a refused loopback proxy. This blocks those configured destinations and proxy-aware HTTP requests, but it is not a host-level egress firewall: clients that ignore proxy variables can still reach external services. The runtime check therefore does not claim that all background activity or external traffic is disabled; run it only in an environment whose network policy is appropriate for disposable tests.

The reusable installer validates every local asset and dependency before making admin requests. `pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. It does not roll back writes if a later asset fails.

Fixture SQL helpers require an explicit disposable loopback database opt-in. Unit tests use local fixture data and fake process/network adapters; they do not seed a database or call an external HappyView service.
