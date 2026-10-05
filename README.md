# Hypercerts API workspace

This checkout combines the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, and the funding-receipt, badge-definition, and work-scope-tag query modules. `api/manifest.json` is authoritative for the assets installed by this checkout.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` validates generated handlers, lint, types, and unit tests. `pnpm build` refreshes declared Lua handler bundles. These commands do not contact a HappyView instance. `pnpm install:api` sends admin requests and requires an explicitly approved target and token.

## Installed HTTP endpoint inventory

`pnpm test:http` runs the installed XRPC handlers against a task-owned disposable local HappyView and PostgreSQL project. It covers the funding, badge-definition, and work-scope-tag endpoints:

| Capability | XRPC endpoints | HTTP contracts |
| --- | --- | --- |
| Funding receipts | `org.hypercerts.funding.getReceipt`, `org.hypercerts.funding.listReceipts` | Record retrieval, repeated filters, stable pagination, and named runtime errors |
| Badge definitions | `app.certified.badge.getBadgeDefinition`, `app.certified.badge.listBadgeDefinitions` | Record/CID retrieval, publisher sidecars, filters, tied pagination, and named runtime errors |
| Work-scope tags | `org.hypercerts.workscope.getWorkscopeTag`, `org.hypercerts.workscope.listWorkscopeTags` | Exact URI retrieval, author filters, hydrated and absent sidecars, bidirectional tied pagination, and named runtime errors |

The HTTP runner uses cached, digest-pinned images only; it does not pull images. See [`api/README.md`](api/README.md) for installer, fixture, and disposable test details. `LICENSE.md` retains the upstream MIT notice.
