# Hypercerts API Endpoints

A standalone static React/Scalar explorer for public Hypercerts XRPC queries served by HappyView. It uses committed Lexicon snapshots to generate its OpenAPI reference; running the explorer does not require a HappyView checkout.

## Run locally

Requires Node.js 22.12.0 or newer and pnpm.

From the workspace root:

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

Open <http://127.0.0.1:5173>. The explorer defaults to `https://api.test.hypercerts.dev`; Local (`http://127.0.0.1:8080`) and Custom server choices are also available. Requests go directly from your browser to the selected server.

To offer named servers, set `VITE_HAPPYVIEW_SERVERS` when starting the dev server or building the site:

```sh
VITE_HAPPYVIEW_SERVERS='[{"label":"Staging","url":"https://api.staging.hypercerts.dev"},{"label":"Test","url":"https://test.api.hypercerts.dev"},{"label":"Production","url":"https://api.hypercerts.dev"}]' pnpm docs:dev
```

The value must be a nonempty JSON array of labeled, distinct http(s) base URLs without credentials, query, or fragment. The first entry is the default; Local and Custom remain available. These URLs are public in the browser bundle, so do not include secrets. Changing a deployed site's configuration requires a rebuild and redeploy.

## Refresh the committed API reference

From the workspace root, run:

```sh
pnpm docs:sync
```

The command reads `api/manifest.json`, the registered module manifests, local API Lexicons, and the pinned `@hypercerts-org/lexicon` package. It refreshes the endpoint index, committed Lexicon snapshots, `openapi.json`, and `coverage.json`. Schema references are resolved locally; the command does not fetch remote Lexicons or contact HappyView. Install the repository-pinned dependencies first with `pnpm install --frozen-lockfile`.

The exact explorer operations and their module inclusion come from the manifest. `coverage.json` describes manifest inclusion only; it does not claim runtime or deployment validation. The endpoint test suite, also run by the workspace-root `pnpm check`, performs a read-only freshness check of the full index metadata, every referenced snapshot (including pinned package schemas), OpenAPI, and coverage against the current API sources. That check requires the pinned Lexicon dependency, but the explorer build and runtime still use committed snapshots without needing an API checkout.

## Build and check

```sh
pnpm --filter hypercerts-api-endpoints build
pnpm --filter hypercerts-api-endpoints preview
pnpm --filter hypercerts-api-endpoints test
```

The filtered `build` command writes the deployable static site to `docs/dist/`; `preview` serves that build locally, and `test` runs the explorer suite. The workspace-root `pnpm build` also builds the API Lua bundles.

**Font licence:** This repo bundles Switzer Variable. Its redistribution through a repository or package may be restricted under the Fontshare ITF Free Font License; resolve that risk before distributing a release. This is not legal clearance.
