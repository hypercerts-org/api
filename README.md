# Hypercerts API workspace

This repository branch contains the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, offline checks, and the vocabulary-tag query capability. The `org.hypercerts.vocab.getVocabTag` and `org.hypercerts.vocab.listVocabTags` handlers are bundled and registered through `api/modules/vocab/manifest.json`.

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

These commands do not deploy or contact a HappyView instance. `pnpm install:api` sends admin requests and requires an explicitly approved target and token. `LICENSE.md` retains the MIT notice.
