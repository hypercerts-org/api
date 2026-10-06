# Hypercerts API workspace

This repository contains the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, offline checks, public badge query endpoints, the vocabulary-tag query capability, and this branch's public context-measurement query endpoints. The `org.hypercerts.vocab.getVocabTag` and `org.hypercerts.vocab.listVocabTags` handlers are bundled and registered through `api/modules/vocab/manifest.json`.

This checkout is one of the additive local sibling branches used to compose the API:

- `tooling/api-foundation` owns the shared installer, pinned schemas, projections, fixtures, and offline checks.
- Capability branches add their independently owned endpoint modules.
- `tooling/docs` adds the endpoint explorer and full schema snapshots.

`api/manifest.json` is authoritative for the API modules included in this checkout. The docs explorer is present on the docs branch.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` validates the pinned Lexicon closure, lint, types, and unit tests. `pnpm build` refreshes the declared Lua handler bundles. These checks do not deploy or contact a HappyView instance.

See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and HTTP test guidance, and [api/README.md](api/README.md) for measurement queries, badge-query and vocabulary-tag endpoints, and API bundle/release installation details. `pnpm install:api` sends admin requests and requires an explicitly approved target and token. `LICENSE.md` retains the upstream MIT notice.
