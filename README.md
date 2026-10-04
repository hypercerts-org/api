# Hypercerts API toolkit foundation

This repository contains the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, offline checks, and public work-scope-tag lookup/listing handlers. Other endpoint handlers are added by capability modules.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` validates the pinned Lexicon closure, lint, types, and unit tests. `pnpm build` refreshes declared Lua handler bundles, including the work-scope-tag queries.

See [`api/README.md`](api/README.md) for installer and fixture details. The `LICENSE.md` file retains the upstream MIT notice.
