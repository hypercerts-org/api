# Hypercerts API workspace

This checkout is one of the additive local sibling branches used to compose the API. It contains the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, offline checks, and the public context measurement query endpoints:

- `tooling/api-foundation` owns the shared installer, pinned schemas, projections, fixtures, and offline checks.
- Capability branches add their independently owned endpoint modules.
- `tooling/docs` adds the endpoint explorer and full schema snapshots.

`api/manifest.json` is authoritative for the API modules included in this checkout. The docs explorer is present on the docs branch.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` validates the pinned Lexicon closure, lint, types, and unit tests. `pnpm build` refreshes the declared Lua handler bundles. These commands do not deploy or contact a HappyView instance.

See [`api/README.md`](api/README.md) for installer, fixture, and HTTP test details. `pnpm install:api` sends admin requests and requires an explicitly approved target and token. The `LICENSE.md` file retains the upstream MIT notice.
