# Changesets

This repository releases two packages, each with its own version:

- `@hypercerts-org/happyview-modules`: the installable API bundle (Lua modules, Lexicons and installer). Released as a Git tag and GitHub Release, not published to npm; operators retrieve the tagged source from this public repository and install it into their own HappyView instance.
- `@hypercerts-org/api`: the TypeScript query definitions and types for clients. Published to npm, with a Git tag and GitHub Release. Not released yet; see [packages/api/README.md](../packages/api/README.md#versioning-and-releases).

Add a Changeset when a pull request changes what either package ships. Run:

```sh
pnpm changeset
```

and select each package the pull request changes. Use `patch` for compatible fixes, `minor` for additive capabilities, and `major` for incompatible changes.

- For `@hypercerts-org/happyview-modules`, write release notes for endpoint or schema additions, compatible behavior changes, fixes, breaking changes, and installer or configuration changes that operators need to know about.
- For `@hypercerts-org/api`, write release notes for client-visible changes: new or changed queries, parameters and types, and the `@hypercerts-org/lexicon` version it builds on. An API change that touches both the modules and the generated client gets an entry for each package.

Do not add Changesets for the separate endpoint-explorer package, documentation-only changes, tests, or release/CI maintenance that does not change what a package ships. If the release impact is unclear, decide with the reviewer rather than guessing a version bump.

A Changesets release PR updates each bumped package's `package.json` and `CHANGELOG.md`. After it is merged to `main`, release CI validates that exact commit, publishes the bumped public packages to npm, and creates a `<package>@X.Y.Z` Git tag and public GitHub Release for each released version.
