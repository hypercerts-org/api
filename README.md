# Hypercerts API workspace

This checkout combines shared HappyView API tooling, independently defined query modules, and the API endpoint explorer.

Included query endpoints:

- Badge definitions: `app.certified.badge.getBadgeDefinition`, `app.certified.badge.listBadgeDefinitions`
- Funding receipts: `org.hypercerts.funding.getReceipt`, `org.hypercerts.funding.listReceipts`
- Contributor information: `org.hypercerts.claim.getContributorInformation`, `org.hypercerts.claim.listContributorInformation`

`api/manifest.json` is authoritative for the modules and validation Lexicons included in this checkout. The `docs/` workspace contains the endpoint explorer and full schema snapshots.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

These commands do not deploy or contact a HappyView instance. `pnpm install:api` sends admin requests and requires an explicitly approved target and token. `LICENSE.md` retains the MIT notice.
