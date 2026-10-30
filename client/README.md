# @hypercerts-org/api

TypeScript query definitions and types for the Hypercerts API, for use with [`@atproto/lex`](https://www.npmjs.com/package/@atproto/lex). Not published to npm yet; use it from this workspace, or from a tarball made with `pnpm pack` (which builds first). A git dependency does not work: `dist/` is not committed.

```ts
import { Client } from "@atproto/lex";
import { getActivity, listBadgeAwards, type ActivityView } from "@hypercerts-org/api";

const api = new Client("https://api.hypercerts.dev");
const { activity } = await api.call(getActivity, { uri });
const { badgeAwards, cursor } = await api.call(listBadgeAwards, { authors: [did], limit: 50 });
```

## What it contains

- One query definition per endpoint, exported by its short name (`getActivity`, `listBadgeAwards`). `Client.call` uses it for the NSID, the parameters and response validation.
- The types of each query's parameters and views (`ActivityView`, `OrganizationActorView`). Each query and defs Lexicon is also exported as a namespace for the types every query shares or that more than one Lexicon defines differently: `GetActivity.$Params`, `GetBadgeDefinition.BadgeDefinitionView`, `ApiDefs.ProfileView`.
- `LEXICON_VERSION`: the `@hypercerts-org/lexicon` version the definitions were generated from, also in `package.json` as `hypercerts.lexiconVersion`.

Records embedded in views are not copied: their schemas and types are imported from [`@hypercerts-org/lexicon/records`](https://github.com/hypercerts-org/hypercerts-lexicon), so `ActivityView["record"]` is the same type as the lexicon package's `Activity`.

ESM only. `@atproto/lex` and `@hypercerts-org/lexicon` are peer dependencies; install versions in the declared ranges.

## Response validation

`Client` validates responses against the Lexicons by default. The indexer may still serve records that fail their Lexicon, and one such record fails a whole list response. Until it stops doing so (TECH-791), read with `new Client(url, { validateResponse: false })`. With validation off, responses are typed but not checked, and schema defaults are not applied: a record the indexer serves can differ from its type, so treat fields defensively.

## How it is generated

`pnpm generate` (or `pnpm client:generate` from the repository root) runs `lex build` over the Lexicons declared in `api/manifest.json` `validationLexicons`: the API's own Lexicons from `api/lexicons/`, and the record Lexicons they reference, read from the installed `@hypercerts-org/lexicon`. It keeps only the API's own Lexicons, points their imports of records at `@hypercerts-org/lexicon/records/<nsid path>.defs` (and fails if a module is missing there), writes `src/lexicons/` and `src/index.ts`, and records the Lexicon version in `package.json`. Generated files are committed; do not edit them.

Regenerate whenever a query Lexicon, `api/manifest.json`, the `@hypercerts-org/lexicon` version or the `@atproto/lex` version (including a lockfile change to its generator dependencies) changes. `pnpm check:generated` fails when the committed output is stale.

The root type exports are stable on purpose: generation fails when the set of view names defined by more than one Lexicon changes (`knownAmbiguousTypes` in `scripts/generate.js`), because a new duplicate would silently remove a root export.

The generator works around [bluesky-social/atproto#5738](https://github.com/bluesky-social/atproto/issues/5738), broken imports for queries under a record NSID. Remove the workaround once it is fixed upstream.

## Unreleased lexicon package

`@hypercerts-org/lexicon/records` is not released yet ([hypercerts-lexicon#270](https://github.com/hypercerts-org/hypercerts-lexicon/pull/270)). Until it is, the package builds against `vendor/hypercerts-org-lexicon-1.7.0.tgz`, a packed build of that pull request. Replace it with the published version (`"@hypercerts-org/lexicon": "1.7.0"`) and delete `vendor/` once it is on npm.

## Commands

Run from `client/`:

| Command                                           | What it does                                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm generate`                                   | Regenerate `src/`                                                                                                       |
| `pnpm check`                                      | Freshness, lint, format check, type check, build and tests                                                              |
| `pnpm lint` / `pnpm format` / `pnpm format:check` | Biome; only `format` rewrites files                                                                                     |
| `pnpm typecheck`                                  | Type-check `src/` and `scripts/`                                                                                        |
| `pnpm build`                                      | Clean and compile to `dist/` (also runs before `pnpm pack`)                                                             |
| `pnpm test`                                       | Build, type-check `test/types.ts` against the built package, and call queries through a `Client` with a stubbed `fetch` |

Tooling follows the SDK repository (TECH-748): Biome, TypeScript 7, ESM, Node 24 or later. `exactOptionalPropertyTypes` is off because code generated by `@atproto/lex` 0.4.2 does not compile with it.

## Versioning

The package is not versioned or released yet: it is listed in the Changesets `ignore` list, because the release workflow only tags the API module bundle (TECH-818). Releases start when the workflow supports more than one package.
