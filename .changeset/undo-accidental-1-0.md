---
"@hypercerts-org/api": minor
---

Version 1.0.0 was published by mistake. This release replaces it and continues from 0.5.0. Use 0.6.0 and do not use 1.0.0. It includes everything 1.0.0 contained:

- [#103](https://github.com/hypercerts-org/api/pull/103): Added DID-only `app.certified.actor.getActor` and `getActors` queries. **Breaking:** replace `app.certified.actor.getOrganization.OrganizationActorView` with `org.hypercerts.api.defs.ActorView`, and import `LocationRecordView` from the same shared namespace. Narrow `actor.organization` before accessing it: the shared TypeScript type allows null even though existing organization queries keep their response shapes.
- [#98](https://github.com/hypercerts-org/api/pull/98): Activity and collection lists can optionally return an exact total for records matching the supplied filters. Set `includeTotal=true` to receive `totalCount`, counted before cursor and page limit, including on empty pages.
- [#101](https://github.com/hypercerts-org/api/pull/101): Set `includeTotal=true` on `org.hypercerts.funding.listReceipts` to get `totalCount`: the number of matching indexed receipts before pagination, even on an empty page. Omit the flag or set it to `false` to skip counting.
- [#106](https://github.com/hypercerts-org/api/pull/106): `app.certified.actor.getProfile` now resolves handles through `https://slingshot.microcosm.blue` when the HappyView script variable `HYPERCERTS_HANDLE_RESOLVER_URL` is unset. A valid value still overrides it; an invalid value still fails with `HandleResolverConfigError`. `pnpm install:api` no longer prompts for, reads or creates that variable, so it does not need `script-variables:*` permissions; existing values are kept. Operators who relied on the installer to set it must set it in HappyView directly.
