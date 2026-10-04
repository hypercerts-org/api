---
name: writing-changesets
description: Write or review Changesets for the Hypercerts API bundle. Use whenever a change may affect API consumers or HappyView operators and a release note or version bump is needed.
---

# Writing Changesets for the Hypercerts API

## When to use

Use this skill when deciding whether a change needs a Changeset, choosing its version bump, or writing or reviewing its release note.

## Decide whether a Changeset is needed

Add a Changeset when a pull request changes the installable API bundle or behavior that HappyView operators will notice. This includes API or schema additions, compatible behavior changes, fixes, breaking changes, and installer or configuration changes operators need to know about.

Do not add one for documentation-only or test-only changes, changes to the separate endpoint-explorer package, or release and CI maintenance that does not change the installable bundle. Base the decision on the actual behavior change, not the size of the pull request. If the impact or version bump is unclear, ask the reviewer rather than guessing.

## Package and version bump

The bundle is versioned as one unit. The Changeset frontmatter must target only `@hypercerts-org/hypercerts-api`:

```md
---
'@hypercerts-org/hypercerts-api': patch
---

A short, clear summary of the change.
```

Choose the bump using this repo's release guidance:

- `patch` for compatible fixes.
- `minor` for new, additive API capabilities.
- `major` for incompatible API changes.

Do not target the endpoint-explorer package or invent additional package entries. Use a descriptive kebab-case filename in `.changeset/`.

## Write for people, not just maintainers

Make the note accessible and easy to understand. A reader should understand the practical change without knowing the internal code or protocol vocabulary. Keep the first sentence short, direct, and focused on what someone using or running the API will notice.

- Prefer familiar words over jargon. Avoid unexplained acronyms, implementation terms, and internal module names.
- State what changed and, when relevant, what an API consumer or operator needs to do.
- Include exact endpoint, field, configuration, or command names only when a reader needs them to adapt; explain unfamiliar terms in plain language.
- Keep technical detail proportional to the action required. Do not turn a release note into a description of the implementation.
- Do not claim that something is published to npm or deployed to a HappyView instance. Releases are distributed as tagged source and GitHub Releases; operators install them into their own instances.

For example, explain a pagination change as “Large result lists can now be loaded a page at a time” before naming any cursor fields a client needs to use. Replace this kind of example with the actual behavior and exact field names for the change being documented.

## Write only what helps the reader

Keep the note as short as the change allows. A useful shape is:

1. One plain-language summary sentence.
2. The specific behavior, compatibility impact, or action needed by API consumers or operators.

Use bullets only when there are several distinct actions or changes to scan. Omit implementation rationale, internal file paths, exhaustive edge cases, and details that do not change what the reader understands or does. Do not repeat the summary in the details.

## Procedure

1. Check the actual diff and read `.changeset/README.md` plus `api/README.md` for the current scope and release behavior.
2. Run `pnpm changeset` and select `@hypercerts-org/hypercerts-api`, or create a descriptive Markdown file under `.changeset/` with the required frontmatter.
3. Write and review the summary using the plain-language guidance above. Make any adaptation steps concrete and accurate.
4. Run `pnpm changeset status` to check that the Changeset is valid and targets the intended package.

## Release context

`@hypercerts-org/hypercerts-api` is marked `"private": true` in `api/package.json`, which prevents it from being published to npm. This flag applies to the package, not the public GitHub repository. Changesets creates a release pull request that updates `api/package.json` and `api/CHANGELOG.md`. After that pull request is merged, CI validates the merged commit and creates a version tag and public GitHub Release. Operators install from the tagged source; this process does not deploy the bundle to a HappyView instance.

## Repository references

- `.changeset/README.md` — package scope, bump rules, and release process.
- `.changeset/config.json` — Changesets configuration and ignored packages.
- `api/package.json` — package name and version.
- `api/README.md` — bundle installation and distribution details.
