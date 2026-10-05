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

These checks do not deploy or contact a HappyView instance. See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and HTTP test guidance, and [api/README.md](api/README.md) for API bundle and release installation details. `LICENSE.md` retains the MIT notice.
