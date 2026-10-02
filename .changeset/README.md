# API bundle changesets

Add a Changeset when a pull request changes the installable API bundle or its operator-visible behavior. Run:

```sh
pnpm changeset
```

Target `@happyview/hypercerts-api-kit` and write release notes for endpoint or schema additions, compatible behavior changes, fixes, breaking changes, and installer or configuration changes that operators need to know about. Use `patch` for compatible fixes, `minor` for additive API capabilities, and `major` for incompatible API changes.

The API bundle is versioned as one unit. Do not add Changesets for the separate endpoint-explorer package, documentation-only changes, tests, or release/CI maintenance that does not change the installable bundle. If the release impact is unclear, decide with the reviewer rather than guessing a version bump.

A Changesets release PR updates `api/package.json` and `api/CHANGELOG.md`. After it is merged to `main`, release CI validates that exact commit and creates an `@happyview/hypercerts-api-kit@X.Y.Z` Git tag and public GitHub Release. The bundle is not published to npm; operators retrieve the tagged source from this public repository and install it into their own HappyView instance.
