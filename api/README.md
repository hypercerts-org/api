# HappyView API toolkit foundation

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, and offline fixture/test utilities. The `modules/shared/manifest.json` contains record schemas and query Lexicons used as shared view types; capability modules register endpoint Lexicons and Lua handlers. The acknowledgements module implements `org.hypercerts.context.getAcknowledgement` and `org.hypercerts.context.listAcknowledgements`.

## Acknowledgement queries

The public `org.hypercerts.context.getAcknowledgement` query accepts one exact acknowledgement AT-URI with a DID authority. It returns `RecordNotFound` when the acknowledgement is not indexed. `org.hypercerts.context.listAcknowledgements` lists indexed acknowledgements globally or with repeated, unbracketed `authors` (DIDs) and `subjects` (AT-URIs) parameters. Values within either filter use OR; the filters combine with AND. Subject matching compares only `record.subject.uri`, not its CID.

Listing sorts by `(createdAt, uri)`, descending by default, with `limit=25` by default and a maximum of 100. The opaque cursor is bound to `sortDirection`; keep the other request parameters unchanged when continuing a page. The response preserves each full record unchanged and hydrates its publisher's Certified profile and raw organization sidecar. A missing profile or sidecar is `null`; `indexedAt` is also `null` when the index has no timestamp. Subject and context references remain unexpanded. These queries do not verify publisher authority or calculate a combined acknowledgement status.

The `modules/acknowledgements/manifest.json` bundle installs the acknowledgement record Lexicon and both query handlers. Runtime queries require the HappyView PostgreSQL index to contain acknowledgement records and publisher profile/organization records. `AcknowledgementQueryFailed` indicates a database or hydration lookup failure; check HappyView's PostgreSQL service rather than treating it as a missing record. Authentication is not required.

For local development, checks, and HTTP runtime test requirements, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Install a released API bundle

Releases version the installable API bundle in this package; they do not publish to npm or deploy to a HappyView instance. This public repository's GitHub Releases and tagged source archives are the distribution channel. Choose an `@hypercerts-org/hypercerts-api@X.Y.Z` release tag, clone that snapshot, install its pinned workspace dependencies from the repository root, then run the installer from `api/`:

```sh
git clone --depth 1 --branch '@hypercerts-org/hypercerts-api@X.Y.Z' https://github.com/hypercerts-org/api.git hypercerts-api
cd hypercerts-api
pnpm install --frozen-lockfile
cd api
HAPPYVIEW_BASE_URL='https://your-happyview.example' HAPPYVIEW_ADMIN_TOKEN='<scoped-admin-token>' pnpm install:api
```

Review that release's notes and target only an explicitly approved HappyView instance.

The reusable installer validates every local asset and dependency before making admin requests. `pnpm install:api` contacts a HappyView instance and uploads declared assets; do not run it without an explicitly approved target and token. It does not roll back writes if a later asset fails.
