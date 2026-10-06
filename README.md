# Hypercerts API workspace

This checkout combines the shared HappyView installer, pinned Lexicon dependencies, reusable Lua projections, fixtures, and public query modules for actor profiles and organizations, activity, badge definitions, collections, context attachments and evaluations, actor and entity follows, recent follows, funding receipts, locations, and work-scope tags. `api/manifest.json` is authoritative for the assets installed by this checkout.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

`pnpm check` validates generated handlers, lint, types, and unit tests. `pnpm build` refreshes declared Lua handler bundles. These checks do not deploy or contact a HappyView instance. `pnpm install:api` sends admin requests and requires an explicitly approved target and token. See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and HTTP test guidance, and [api/README.md](api/README.md) for API bundle and release installation details.

## Installed HTTP endpoint inventory

`pnpm test:http` runs installed XRPC handlers against a task-owned disposable local HappyView and PostgreSQL project. It covers:

| Capability | XRPC endpoints | HTTP contracts |
| --- | --- | --- |
| Funding receipts | `org.hypercerts.funding.getReceipt`, `org.hypercerts.funding.listReceipts` | Record retrieval, repeated filters, stable pagination, and named runtime errors |
| Badge definitions | `app.certified.badge.getBadgeDefinition`, `app.certified.badge.listBadgeDefinitions` | Record/CID retrieval, publisher sidecars, filters, tied pagination, and named runtime errors |
| Work-scope tags | `org.hypercerts.workscope.getWorkscopeTag`, `org.hypercerts.workscope.listWorkscopeTags` | Exact-URI retrieval, author filters, hydrated and null sidecars, middle-position `indexedAt` fallback, tied pagination in both directions, and named runtime errors |
| Actor profiles | `app.certified.actor.getProfile`, `app.certified.actor.getProfiles`, `app.certified.actor.listProfiles`, `app.certified.actor.searchProfiles` | Single and batch retrieval, batch null results, profile-sidecar hydration, filters, `createdAt`/URI pagination ties, and named errors |
| Actor organizations | `app.certified.actor.getOrganization`, `app.certified.actor.getOrganizations`, `app.certified.actor.listOrganizations`, `app.certified.actor.searchOrganizations` | Single and batch retrieval, batch null results, profile-sidecar hydration, filters, `createdAt`/URI pagination ties, and named errors |
| Activity | `org.hypercerts.claim.getActivity`, `org.hypercerts.claim.listActivities`, `org.hypercerts.claim.searchActivities` | Contributor-sidecar hydration, author/organization/contributor/URI filters, tied timestamp pagination, and literal wildcard search |
| Collections | `org.hypercerts.collection.getCollection`, `org.hypercerts.collection.listCollections`, `org.hypercerts.collection.searchCollections`, `org.hypercerts.collection.listCollectionItems` | CBOR-derived CIDs, location/tag projections, author, organization, item and tag filters, title/shortDescription search, tied pagination, and source-order item pagination with exact-version resolution |
| Context attachments and evaluations | `org.hypercerts.context.getAttachment`, `org.hypercerts.context.listAttachments`, `org.hypercerts.context.getEvaluation`, `org.hypercerts.context.listEvaluations` | Publisher/evaluator sidecars, list filters, pagination across tied `createdAt` values, and named runtime errors |
| Actor follows | `app.certified.graph.getFollow`, `app.certified.graph.listActorFollowers`, `app.certified.graph.listActorFollowing` | Actor lookup and lists, tied-key pagination, and nullable profile/organization sidecars |
| Entity follows | `app.certified.graph.getEntityFollow`, `app.certified.graph.listEntityFollowers`, `app.certified.graph.listEntityFollowing` | Entity lookup and lists, tied-key pagination, nullable sidecars, and entity target resolution |
| Recent follows | `app.certified.graph.listRecentFollows` | Global recent-follows `before` filter |
| Locations | `app.certified.location.getLocation`, `app.certified.location.listLocations` | Nullable sidecars, repeated author/URI/location-type filters, unsupported-search errors, tied pagination in both directions, malformed/absent `createdAt` handling, and named errors |

The HTTP runner uses cached, digest-pinned images only; it does not pull images. `LICENSE.md` retains the upstream MIT notice.
