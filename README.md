# Hypercerts API toolkit foundation

This repository branch contains the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, offline checks, and the feature-query capability module. The feature module implements public `org.hypercerts.entity.getFeature` and `org.hypercerts.entity.listFeatures` queries.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` validates the pinned Lexicon closure, lint, types, and unit tests. `pnpm build` refreshes the Lua handler bundles declared by the aggregate and module manifests.

See [`api/README.md`](api/README.md) for installer and fixture details. The `LICENSE.md` file retains the upstream MIT notice.
