# Hypercerts API toolkit foundation

This repository branch contains the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, and offline checks. It contains shared view Lexicons only; endpoint-specific Lua handlers are added by capability branches.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` validates the pinned Lexicon closure, lint, types, and unit tests. `pnpm build` refreshes declared Lua handler bundles; there are no endpoint handlers in this foundation branch.

See [`api/README.md`](api/README.md) for installer and fixture details. The `LICENSE.md` file retains the upstream MIT notice.
