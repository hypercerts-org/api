# Hypercerts API workspace

This repository contains the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, offline checks, and the public badge query endpoints. This checkout is one of the additive local sibling branches used to compose the API; other endpoint handlers are added by capability branches.

- `tooling/api-foundation` owns the shared installer, pinned schemas, projections, fixtures, and offline checks.
- Capability branches add their independently owned endpoint modules.
- `tooling/docs` adds the endpoint explorer and full schema snapshots.

`api/manifest.json` is authoritative for the API modules included in this checkout. The docs explorer is present on the docs branch.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

These checks do not deploy or contact a HappyView instance. See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and HTTP test guidance, and [api/README.md](api/README.md) for API bundle, badge-query, and release installation details. `LICENSE.md` retains the MIT notice.
