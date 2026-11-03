---
'@hypercerts-org/api': minor
---

First release of `@hypercerts-org/api`: TypeScript query definitions and types for the Hypercerts API, for use with the [`@atproto/lex`](https://www.npmjs.com/package/@atproto/lex) client. Every query is at its NSID path (`api.call(org.hypercerts.claim.getActivity, { uri })`), with typed parameters and views. The records in those views are the schemas of `@hypercerts-org/lexicon` 2.0, so a record type is the same in both packages. Install it with its peer dependencies, `@hypercerts-org/lexicon` ^2.0.0 and `@atproto/lex` ^0.4.2.
