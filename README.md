# Hypercerts API workspace

This checkout is one of the additive local sibling branches used to compose the API:

- `tooling/api-foundation` owns the shared HappyView installer, pinned schemas, projections, fixtures, and offline checks.
- Capability branches add their independently owned endpoint modules. This branch includes the public `org.hypercerts.claim.getRights` and `org.hypercerts.claim.listRights` queries.
- `tooling/docs` adds the endpoint explorer and full schema snapshots.

`api/manifest.json` is authoritative for the API modules included in this checkout. The docs explorer is present on the docs branch.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` validates the pinned Lexicon closure, lint, types, and unit tests. `pnpm build` refreshes the declared Lua handler bundles, including both rights queries. These commands do not deploy or contact a HappyView instance. `pnpm install:api` sends admin requests and requires an explicitly approved target and token.

See [`api/README.md`](api/README.md) for installer and fixture details. The `LICENSE.md` file retains the upstream MIT notice.
