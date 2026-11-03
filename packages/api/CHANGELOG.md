# @hypercerts-org/api

## 0.1.0

### Minor Changes

- [#48](https://github.com/hypercerts-org/api/pull/48) [`ffa08d7`](https://github.com/hypercerts-org/api/commit/ffa08d73b6118b269a1307b39a49da97b82a6604) Thanks [@kristoferlund](https://github.com/kristoferlund)! - First release of `@hypercerts-org/api`: TypeScript query definitions and types for the Hypercerts API, for use with the [`@atproto/lex`](https://www.npmjs.com/package/@atproto/lex) client. Every query is at its NSID path (`api.call(org.hypercerts.claim.getActivity, { uri })`), with typed parameters and views. The records in those views are the schemas of `@hypercerts-org/lexicon` 2.0, so a record type is the same in both packages. Install it with its peer dependencies, `@hypercerts-org/lexicon` ^2.0.0 and `@atproto/lex` ^0.4.2.
