# @hypercerts-org/api

TypeScript query definitions and types for the Hypercerts API, for use with [`@atproto/lex`](https://www.npmjs.com/package/@atproto/lex). Install it with its peer dependencies:

```sh
npm install @hypercerts-org/api @hypercerts-org/lexicon @atproto/lex
```

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

The package exports [lex's NSID namespace tree](https://www.npmjs.com/package/@atproto/lex) (`app`, `com`, `org`, `pub`), the same layout as [`@hypercerts-org/lexicon`](https://www.npmjs.com/package/@hypercerts-org/lexicon), so every name is an NSID:

- Each query is at its NSID path (`org.hypercerts.claim.getActivity`), for `Client.call`, with its parameter and view types on the same path (`.$Params`, `.ActivityView`). Shared views are in `org.hypercerts.api.defs` and `org.hypercerts.entity.defs`.
- The records and other definitions the queries reference are in the same tree, but they are the modules of [`@hypercerts-org/lexicon`](https://github.com/hypercerts-org/hypercerts-lexicon), re-exported, not copied: `org.hypercerts.claim.activity` is the same module in both packages, and `ActivityView["record"]` is `org.hypercerts.claim.activity.Main`. A record no query returns, such as `org.hyperboards.board`, is not in this tree; import it from `@hypercerts-org/lexicon`. Where a record has queries under its NSID (`org.hypercerts.collection`), the namespace here adds the query modules to the record's exports.
- `LEXICON_VERSION`: the `@hypercerts-org/lexicon` version the definitions were generated from, also in `package.json` as `hypercerts.lexiconVersion`.

ESM only. `@atproto/lex` and `@hypercerts-org/lexicon` are peer dependencies; install versions in the declared ranges.

## Response validation

`Client` validates responses against the Lexicons by default. The indexer may still serve records that fail their Lexicon, and one such record fails a whole list response. Until it stops doing so (TECH-791), read with `new Client(url, { validateResponse: false })`. With validation off, responses are typed but not checked, and schema defaults are not applied: a record the indexer serves can differ from its type, so treat fields defensively.

## How it is generated

`pnpm generate` (or `pnpm client:generate` from the repository root) runs `lex build --index-file` over the Lexicons declared in `happyview-modules/manifest.json` `validationLexicons`: the API's own Lexicons from `happyview-modules/lexicons/`, and the record Lexicons they reference, read from the installed `@hypercerts-org/lexicon`. It keeps the modules of the API's own Lexicons and the namespace modules on the path to them, points every other import or re-export at `@hypercerts-org/lexicon/<nsid path>`, or at the package root for a top-level namespace (`com`, `pub`), and fails if the lexicon package does not export it, writes `src/lexicons/` and `src/index.ts`, and records the Lexicon version in `package.json`.

Generated files start with a banner naming `scripts/generate.js`, which rewrites lex's output. They are committed, unlike in the lexicon repository: `src/` is what reviewers see change when an API Lexicon changes, and `pnpm check:generated` fails when it is stale. Do not edit them.

Regenerate whenever a query Lexicon, `happyview-modules/manifest.json`, the `@hypercerts-org/lexicon` version or the `@atproto/lex` version (including a lockfile change to its generator dependencies) changes.

The generator works around [bluesky-social/atproto#5738](https://github.com/bluesky-social/atproto/issues/5738), broken imports for queries under a record NSID. Remove the workaround once it is fixed upstream.

## Commands

Run from `packages/api/`:

| Command                                           | What it does                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm generate`                                   | Regenerate `src/`                                                                                                                                                         |
| `pnpm check`                                      | Freshness, lint, format check, type check, build and tests                                                                                                                |
| `pnpm lint` / `pnpm format` / `pnpm format:check` | Biome; only `format` rewrites files                                                                                                                                       |
| `pnpm typecheck`                                  | Type-check `src/`                                                                                                                                                         |
| `pnpm build`                                      | Clean and compile to `dist/` (also runs before `pnpm pack`)                                                                                                               |
| `pnpm test`                                       | Build, type-check `test/types.ts` against the built package, and call queries through a `Client` with a stubbed `fetch`                                                   |
| `pnpm check:package`                              | Pack, install the tarball in an empty project, import it in Node, typecheck a consumer and bundle a query with Vite, as in the SDK repository (needs network; CI runs it) |

Tooling follows the SDK repository (TECH-748): Biome, TypeScript 7, ESM, Node 24 or later. `exactOptionalPropertyTypes` is off because code generated by `@atproto/lex` 0.4.2 does not compile with it.

## Versioning and releases

The package is versioned with Changesets, independently of the API modules. The release workflow publishes it to npm with [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) and provenance, and creates an `@hypercerts-org/api@X.Y.Z` tag and GitHub Release, when a Release PR that bumps it is merged.

The first release needs a Trusted Publisher for `@hypercerts-org/api` on npmjs.com (repository `hypercerts-org/api`, workflow `release.yml`). If npm requires the package to exist before one can be configured, an owner of the `@hypercerts-org` npm scope publishes the first version by hand.

`@hypercerts-org/lexicon` is a peer dependency: the record types come from it. The version the package is generated from is pinned in `devDependencies` and must match the one `happyview-modules/` validates against (a test checks this), so the client's types describe what the server accepts. When it changes, regenerate `src/` (see [How it is generated](#how-it-is-generated)).

## License

Licensed under either [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
