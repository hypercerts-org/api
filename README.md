# Hypercerts API workspace

This checkout combines shared HappyView API tooling, pinned Lexicon dependencies, reusable Lua projections, fixtures, offline checks, independently defined query modules, public badge query endpoints, the vocabulary-tag query capability, and the API endpoint explorer. The `org.hypercerts.vocab.getVocabTag` and `org.hypercerts.vocab.listVocabTags` handlers are bundled and registered through `api/modules/vocab/manifest.json`.

This checkout is one of the additive local sibling branches used to compose the API:

Included query endpoints:

- Badge definitions: `app.certified.badge.getBadgeDefinition`, `app.certified.badge.listBadgeDefinitions`
- Badge queries: `app.certified.badge.searchBadgeDefinitions`, `app.certified.badge.getBadgeAward`, `app.certified.badge.listBadgeAwards`, `app.certified.badge.getBadgeResponse`, `app.certified.badge.listBadgeResponses`
- Funding receipts: `org.hypercerts.funding.getReceipt`, `org.hypercerts.funding.listReceipts`
- Acknowledgements: `org.hypercerts.context.getAcknowledgement`, `org.hypercerts.context.listAcknowledgements`
- Contributions: `org.hypercerts.claim.getContribution`, `org.hypercerts.claim.listContributions`
- Contributor information: `org.hypercerts.claim.getContributorInformation`, `org.hypercerts.claim.listContributorInformation`
- Vocabulary tags: `org.hypercerts.vocab.getVocabTag`, `org.hypercerts.vocab.listVocabTags`

`api/manifest.json` is authoritative for the modules and validation Lexicons included in this checkout. The `docs/` workspace contains the endpoint explorer and full schema snapshots.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

These checks do not deploy or contact a HappyView instance. See [CONTRIBUTING.md](CONTRIBUTING.md) for local development and HTTP test guidance, and [api/README.md](api/README.md) for API bundle, query behavior, and release installation details. `LICENSE.md` retains the MIT notice.
