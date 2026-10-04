# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` contains record schemas and query Lexicons used as shared view types; it contains no Lua endpoint scripts. A foundation-only install therefore does not implement those queries.

## Local checks

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

These checks are offline and do not require a HappyView instance or database. `pnpm check` runs generated-source freshness, JavaScript/Lua lint, typechecking, and unit tests. `pnpm build` emits only Lua handlers declared by the root and module manifests. Shared Lua files are bundled into capability handlers but are not installed independently.

The reusable installer validates every local asset and dependency before making admin requests. `pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. It does not roll back writes if a later asset fails.

Fixture SQL helpers require an explicit disposable loopback database opt-in. Unit tests use local fixture data and fake process/network adapters; they do not seed a database or call an external HappyView service.

## Contributor-information queries

The shared module provides two public queries for `org.hypercerts.claim.contributorInformation` records:

- `org.hypercerts.claim.getContributorInformation({ uri })` returns `{ contributorInformation }` for the exact full record AT-URI. The authority must be a DID. An unindexed URI returns `RecordNotFound`.
- `org.hypercerts.claim.listContributorInformation({ authors?, sortDirection?, limit?, cursor? })` returns `{ contributorInformation, cursor? }`. `authors` filters publisher repository DIDs (OR semantics), supplied as repeated unbracketed query keys, with at most 100 values.

Both responses use the shared `ContributorInformationView`: record metadata (`uri`, `cid`, nullable `indexedAt`, and publisher `did`), an `author` actor view, and the original full indexed `record`. The older proposal snippet that omits `nullable` for `indexedAt` is stale; the accepted API design requires this field to remain present as JSON `null` when the database timestamp is null. The author contains the publisher's current Certified profile and raw organization sidecar; each is `null` when missing. The record's contributor identifier is not resolved, and referencing activities are not expanded. Operational query or required hydration failures return errors rather than empty or partial results.

Listings default to 25 records and accept limits from 1 through 100. They sort by `(createdAt, uri)` in descending order unless `sortDirection` is `asc`; cursors are opaque and direction-bound. Keep filters and direction unchanged when continuing a page. The `cursor` property is omitted when there is no next page. A singular `RecordNotFound` means HappyView has no indexed row at that URI; it does not prove the record is absent or deleted from its PDS.

### Operator notes

Both queries require the HappyView PostgreSQL backend, including the profile and organization lookups used to hydrate publishers. A missing sidecar is normal and returned as `null`; a backend or lookup failure is an endpoint error. Build and validate locally with `pnpm build:lua` and `pnpm check`. Register these assets through the existing `pnpm install:api` workflow only after confirming the intended HappyView target and credentials; the installer performs external admin writes.
