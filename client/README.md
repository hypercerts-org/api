# @hypercerts-org/api

TypeScript query definitions and types for the Hypercerts API, for use with [`@atproto/lex`](https://www.npmjs.com/package/@atproto/lex). Not published to npm yet; use it from this workspace, or from a tarball made with `pnpm pack` (which builds first). A git dependency does not work: `dist/` is not committed.

```ts
import { Client } from "@atproto/lex";
import { app, org } from "@hypercerts-org/api";

const api = new Client("https://api.hypercerts.dev");
const { activity } = await api.call(org.hypercerts.claim.getActivity, { uri });
const { badgeAwards, cursor } = await api.call(app.certified.badge.listBadgeAwards, {
  authors: [did],
  limit: 50,
});

type ActivityView = org.hypercerts.claim.getActivity.ActivityView;
type Activity = org.hypercerts.claim.activity.Main; // the record, from @hypercerts-org/lexicon
```

## What it contains

The package exports [lex's NSID namespace tree](https://www.npmjs.com/package/@atproto/lex) (`app`, `com`, `org`, `pub`), the same layout as `@hypercerts-org/lexicon/records`, so every name is an NSID:

- Each query is at its NSID path (`org.hypercerts.claim.getActivity`), for `Client.call`, with its parameter and view types on the same path (`.$Params`, `.ActivityView`). Shared views are in `org.hypercerts.api.defs` and `org.hypercerts.entity.defs`.
- Records and the other definitions views embed are in the same tree, but they are the modules of [`@hypercerts-org/lexicon/records`](https://github.com/hypercerts-org/hypercerts-lexicon), re-exported, not copied: `org.hypercerts.claim.activity` is the same module in both packages, and `ActivityView["record"]` is `org.hypercerts.claim.activity.Main`. An app can import everything from this package.
- `LEXICON_VERSION`: the `@hypercerts-org/lexicon` version the definitions were generated from, also in `package.json` as `hypercerts.lexiconVersion`.

ESM only. `@atproto/lex` and `@hypercerts-org/lexicon` are peer dependencies; install versions in the declared ranges.

## Response validation

`Client` validates responses against the Lexicons by default. The indexer may still serve records that fail their Lexicon, and one such record fails a whole list response. Until it stops doing so (TECH-791), read with `new Client(url, { validateResponse: false })`. With validation off, responses are typed but not checked, and schema defaults are not applied: a record the indexer serves can differ from its type, so treat fields defensively.

## How it is generated

`pnpm generate` (or `pnpm client:generate` from the repository root) runs `lex build --index-file` over the Lexicons declared in `api/manifest.json` `validationLexicons`: the API's own Lexicons from `api/lexicons/`, and the record Lexicons they reference, read from the installed `@hypercerts-org/lexicon`. It keeps the modules of the API's own Lexicons and the namespace modules on the path to them, points every other import or re-export at `@hypercerts-org/lexicon/records/<nsid path>` (and fails if a module is missing there), writes `src/lexicons/` and `src/index.ts`, and records the Lexicon version in `package.json`.

Generated files are committed, unlike in the lexicon repository: `src/` is what reviewers see change when an API Lexicon changes, and `pnpm check:generated` fails when it is stale. Do not edit them.

Regenerate whenever a query Lexicon, `api/manifest.json`, the `@hypercerts-org/lexicon` version or the `@atproto/lex` version (including a lockfile change to its generator dependencies) changes.

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
| `pnpm check:package`                              | Pack, install the tarball in an empty project and check it in Node and TypeScript (needs network; CI runs it)           |

Tooling follows the SDK repository (TECH-748): Biome, TypeScript 7, ESM, Node 24 or later. `exactOptionalPropertyTypes` is off because code generated by `@atproto/lex` 0.4.2 does not compile with it.

## Versioning

The package is not versioned or released yet: it is listed in the Changesets `ignore` list, because the release workflow only tags the API module bundle (TECH-818). Releases start when the workflow supports more than one package.
