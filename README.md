# Hypercerts API workspace

This repository contains the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, offline checks, public badge query endpoints, and the vocabulary-tag query capability. The `org.hypercerts.vocab.getVocabTag` and `org.hypercerts.vocab.listVocabTags` handlers are bundled and registered through `api/modules/vocab/manifest.json`.

This checkout is one of the additive local sibling branches used to compose the API:

- `tooling/api-foundation` owns the shared HappyView installer, pinned schemas, projections, fixtures, and offline checks.
- Capability branches add their independently owned endpoint modules. This checkout includes the rights and contribution queries as well as the public badge query endpoints.
- `tooling/docs` adds the endpoint explorer and full schema snapshots.

`api/manifest.json` is authoritative for the API modules included in this checkout. The docs explorer is present on the docs branch.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` validates the pinned Lexicon closure, lint, types, unit tests, and docs endpoint tests. `pnpm build` refreshes the declared Lua handler bundles, including the rights, contribution, and badge-query handlers. These checks do not deploy or contact a HappyView instance. `pnpm install:api` sends admin requests and requires an explicitly approved target and token.

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and HTTP test guidance, and [`api/README.md`](api/README.md) for installer, contribution, rights-query, badge-query, and released-bundle details. The `LICENSE.md` file retains the upstream MIT notice.
