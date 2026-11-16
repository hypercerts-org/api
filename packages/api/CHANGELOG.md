# @hypercerts-org/api

## 0.4.0

### Minor Changes

- [#73](https://github.com/hypercerts-org/api/pull/73) [`3090a34`](https://github.com/hypercerts-org/api/commit/3090a34da204a95917daee1cdd7f5b0d5abbad3b) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Evaluation evaluators now have one simple shape: a `did`, plus `profile` and `organization` when they were found. The `hydrationStatus` field is gone and missing values are left out instead of `null`. Only the first 100 evaluators in a response are looked up; later ones carry just the `did`. This also fixes `listEvaluations` and `getEvaluation` failing response validation when evaluators were present.

## 0.3.1

### Patch Changes

- [#69](https://github.com/hypercerts-org/api/pull/69) [`b4eedff`](https://github.com/hypercerts-org/api/commit/b4eedff0b6ffb3ce74edf460a39393497c1bd221) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Batch queries now accept 100 typical record links in one request.

  The limit on the encoded request URL path and query for `getFollows`, `getEntityFollows`, `getFollowerCounts` and `getCommentCounts` rises from 7,000 to 16,384 bytes. `getReactionCounts` and `getActorReactions` now enforce the same limit. Requests over the limit are still rejected with an `InvalidRequest` message, returned as HTTP 500 by the current HappyView release.

- [#70](https://github.com/hypercerts-org/api/pull/70) [`2e8f9fc`](https://github.com/hypercerts-org/api/commit/2e8f9fc8d44997a9aecdb2cd3c671cdc1203599d) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Follower counts and follow lists no longer include old project follows saved as account follows.

  Some apps followed a project by saving an account follow whose `via` points to the followed organization's own collection. Those records are now ignored by `getFollow`, `getFollows`, `listActorFollowers`, `listActorFollowing`, `getFollowerCounts` and `listRecentFollows`, so organization follower counts may drop. Follows with any other `via` (a starter pack, a list, or another account's collection) are unchanged, and nothing is deleted.

## 0.3.0

### Minor Changes

- [#63](https://github.com/hypercerts-org/api/pull/63) [`102293a`](https://github.com/hypercerts-org/api/commit/102293a9dcf86026e38f71356951bada7bd7bf76) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Organization queries (`getOrganization`, `getOrganizations`, `listOrganizations`, `searchOrganizations`) now return each organization's location record in `location` (the resolved view of the strong reference at `organization.record.location`, which is unchanged), so you no longer need a second `getLocation` call. It is the location record exactly as stored, or `null` when the organization has no location or the record is not indexed.

## 0.2.0

### Minor Changes

- [#57](https://github.com/hypercerts-org/api/pull/57) [`3848180`](https://github.com/hypercerts-org/api/commit/384818048e536f72a7e74f83d06aa44b2dafe8ba) Thanks [@Kzoeps](https://github.com/Kzoeps)! - - `app.certified.badge.listBadgeAwards` accepts `includeTotal`. When it is `true`, the output includes `totalCount`: the number of award records matching all filters, before cursor and limit, not deduplicated. It is also returned on empty pages.

- [#54](https://github.com/hypercerts-org/api/pull/54) [`97c2d98`](https://github.com/hypercerts-org/api/commit/97c2d989e1ac5dcda17bd0b3399e0860135bf639) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Add `org.hypercerts.context.getCommentCounts`, which returns comment counts for up to 100 subject records in one call.

  `getEntityFollows` and `getActorReactions` now reject subject URIs whose DID has a malformed `%` escape, as `getReactionCounts` already did, instead of returning null for them.

- [#58](https://github.com/hypercerts-org/api/pull/58) [`45137f2`](https://github.com/hypercerts-org/api/commit/45137f271c07db3ca20ad06d051f66d0d1178033) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Add `app.certified.graph.getFollowerCounts`, which returns follower counts for up to 100 account DIDs and entity AT-URIs in one call.

## 0.1.0

### Minor Changes

- [#48](https://github.com/hypercerts-org/api/pull/48) [`ffa08d7`](https://github.com/hypercerts-org/api/commit/ffa08d73b6118b269a1307b39a49da97b82a6604) Thanks [@kristoferlund](https://github.com/kristoferlund)! - First release of `@hypercerts-org/api`: TypeScript query definitions and types for the Hypercerts API, for use with the [`@atproto/lex`](https://www.npmjs.com/package/@atproto/lex) client. Every query is at its NSID path (`api.call(org.hypercerts.claim.getActivity, { uri })`), with typed parameters and views. The records in those views are the schemas of `@hypercerts-org/lexicon` 2.0, so a record type is the same in both packages. Install it with its peer dependencies, `@hypercerts-org/lexicon` ^2.0.0 and `@atproto/lex` ^0.4.2.
