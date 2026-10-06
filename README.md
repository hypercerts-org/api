# Hypercerts API workspace

This workspace combines the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, and offline checks with additive capability modules. This checkout is one of the local sibling branches used to compose the API and includes the public `org.hypercerts.entity.getFeature` and `org.hypercerts.entity.listFeatures` queries, the `org.hypercerts.claim.getContribution` and `org.hypercerts.claim.listContributions` queries, the badge query endpoints, and `org.hypercerts.vocab.getVocabTag` and `org.hypercerts.vocab.listVocabTags` registered through `api/modules/vocab/manifest.json`; other handlers are added by capability branches.

- `tooling/api-foundation` owns the shared installer, pinned schemas, projections, fixtures, and offline checks.
- Capability branches add their independently owned endpoint modules.
- `tooling/docs` adds the endpoint explorer and full schema snapshots.

`api/manifest.json` is authoritative for the API modules included in this checkout. The docs explorer is present on the docs branch.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

These checks do not deploy or contact a HappyView instance. See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and HTTP test guidance, and [api/README.md](api/README.md) for API bundle, badge-query, vocabulary-tag, and release installation details. `LICENSE.md` retains the MIT notice.
