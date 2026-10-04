# Hypercerts API toolkit foundation

This branch contains the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, and the public `org.hypercerts.claim.getRights` and `org.hypercerts.claim.listRights` query handlers.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` validates the pinned Lexicon closure, lint, types, and unit tests. `pnpm build` refreshes the declared Lua handler bundles, including both rights queries.

See [`api/README.md`](api/README.md) for installer and fixture details. The `LICENSE.md` file retains the upstream MIT notice.
