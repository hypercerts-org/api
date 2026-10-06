# Hypercerts API workspace

This workspace combines the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, and offline checks with additive capability modules. This checkout includes the public `org.hypercerts.entity.getFeature` and `org.hypercerts.entity.listFeatures` queries, the `org.hypercerts.claim.getContribution` and `org.hypercerts.claim.listContributions` queries, and the public badge query endpoints; other endpoint handlers are added by capability branches.

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
