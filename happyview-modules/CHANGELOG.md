# @hypercerts-org/happyview-modules

## 0.8.0

### Minor Changes

- [#103](https://github.com/hypercerts-org/api/pull/103) [`f1cf4ab`](https://github.com/hypercerts-org/api/commit/f1cf4abf4853d3a12862c3c1cfaf05fded7df375) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Look up indexed actor profiles, organizations, and primary locations by DID with `app.certified.actor.getActor` and `getActors`. Batch results keep input order and duplicates. `getActor` makes one best-effort handle lookup and includes the handle when it succeeds; `getActors` makes no resolver calls and omits handles. Existing organization responses are unchanged.

- [#98](https://github.com/hypercerts-org/api/pull/98) [`0e95364`](https://github.com/hypercerts-org/api/commit/0e9536487a17ea771d20bb68319892bb90be596f) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Activity and collection lists can optionally return an exact total for records matching the supplied filters. Set `includeTotal=true` to receive `totalCount`, counted before cursor and page limit, including on empty pages.

- [#101](https://github.com/hypercerts-org/api/pull/101) [`2e8600f`](https://github.com/hypercerts-org/api/commit/2e8600f4986ad6cc72b1873aa1e3eaf7604e23db) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Set `includeTotal=true` on `org.hypercerts.funding.listReceipts` to get `totalCount`: the number of matching indexed receipts before pagination, even on an empty page. Omit the flag or set it to `false` to skip counting.

- [#106](https://github.com/hypercerts-org/api/pull/106) [`34003e2`](https://github.com/hypercerts-org/api/commit/34003e299bbb6661d0830d8abd5f7ccb86531043) Thanks [@Kzoeps](https://github.com/Kzoeps)! - `app.certified.actor.getProfile` now resolves handles through `https://slingshot.microcosm.blue` when the HappyView script variable `HYPERCERTS_HANDLE_RESOLVER_URL` is unset. A valid value still overrides it; an invalid value still fails with `HandleResolverConfigError`. `pnpm install:api` no longer prompts for, reads or creates that variable, so it does not need `script-variables:*` permissions; existing values are kept. Operators who relied on the installer to set it must set it in HappyView directly.

### Patch Changes

- [#104](https://github.com/hypercerts-org/api/pull/104) [`41083bb`](https://github.com/hypercerts-org/api/commit/41083bbeda5d412350e9412e2ad10602453377ab) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Record subject AT-URIs in `getCommentCounts`, `getReactionCounts`, `getFollowerCounts`, `getEntityFollows` and `getActorReactions` now use the same DID check as other queries. A DID with an opaque percent sequence such as `%GG` is accepted instead of rejected.

## 0.7.2

### Patch Changes

- [#86](https://github.com/hypercerts-org/api/pull/86) [`7c0da77`](https://github.com/hypercerts-org/api/commit/7c0da77775c69c4285a92983c6a15cf66c4bff81) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Query definitions now state what the API already does: `limit` defaults to 25 and `sortDirection` to `desc`, `getLocation` documents its `InvalidRequest` error, and `indexedAt` on location and evaluation results can be null.

  Client type changes (no wire change):
  - `indexedAt` on `locationView` and `evaluationView` is now `string | null`; handle null if you read it.
  - On list endpoints with new defaults, `$Params` now describes parsed params, so `limit` and `sortDirection` are required there. `client.call(..., {})` still compiles. If you annotate request objects with `$Params` and omit those keys, use `l.InferInput<typeof $params>` instead.

- [#91](https://github.com/hypercerts-org/api/pull/91) [`99f4e8f`](https://github.com/hypercerts-org/api/commit/99f4e8f2646fc353163377692e5b7f4b286716cf) Thanks [@Kzoeps](https://github.com/Kzoeps)! - A list request whose `cursor` or `before` timestamp is in year 0000 now returns an `InvalidRequest` error. Several endpoints used to answer it with an HTTP 500. `listVocabTags` now reports this as "cursor is malformed".

## 0.7.1

### Patch Changes

- [#82](https://github.com/hypercerts-org/api/pull/82) [`410d2cf`](https://github.com/hypercerts-org/api/commit/410d2cf577fef2335065bb1b33cfb737767ab570) Thanks [@Kzoeps](https://github.com/Kzoeps)! - `getReactionCounts`, `getCommentCounts` and `getFollowerCounts` (for entity subjects) now look counts up in HappyView's record-reference table instead of scanning every like, repost, comment or follow, so they stay fast as those collections grow. Responses and errors are unchanged. Counts are only as complete as that table: a record whose references were never written is not counted, so check the table is complete before deploying.

## 0.7.0

### Minor Changes

- [#76](https://github.com/hypercerts-org/api/pull/76) [`619c9ee`](https://github.com/hypercerts-org/api/commit/619c9eeee336dc1d2c03294847298d3e27e9459b) Thanks [@Kzoeps](https://github.com/Kzoeps)! - `app.certified.actor.searchOrganizations` now also searches an organization's legal name. Organizations without a profile can now be found by legal name; before, they never appeared in search results.

## 0.6.0

### Minor Changes

- [#73](https://github.com/hypercerts-org/api/pull/73) [`3090a34`](https://github.com/hypercerts-org/api/commit/3090a34da204a95917daee1cdd7f5b0d5abbad3b) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Evaluation evaluators now have one simple shape: a `did`, plus `profile` and `organization` when they were found. The `hydrationStatus` field is gone and missing values are left out instead of `null`. Only the first 100 evaluators in a response are looked up; later ones carry just the `did`. This also fixes `listEvaluations` and `getEvaluation` failing response validation when evaluators were present.

## 0.5.1

### Patch Changes

- [#69](https://github.com/hypercerts-org/api/pull/69) [`b4eedff`](https://github.com/hypercerts-org/api/commit/b4eedff0b6ffb3ce74edf460a39393497c1bd221) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Batch queries now accept 100 typical record links in one request.

  The limit on the encoded request URL path and query for `getFollows`, `getEntityFollows`, `getFollowerCounts` and `getCommentCounts` rises from 7,000 to 16,384 bytes. `getReactionCounts` and `getActorReactions` now enforce the same limit. Requests over the limit are still rejected with an `InvalidRequest` message, returned as HTTP 500 by the current HappyView release.

- [#70](https://github.com/hypercerts-org/api/pull/70) [`2e8f9fc`](https://github.com/hypercerts-org/api/commit/2e8f9fc8d44997a9aecdb2cd3c671cdc1203599d) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Follower counts and follow lists no longer include old project follows saved as account follows.

  Some apps followed a project by saving an account follow whose `via` points to the followed organization's own collection. Those records are now ignored by `getFollow`, `getFollows`, `listActorFollowers`, `listActorFollowing`, `getFollowerCounts` and `listRecentFollows`, so organization follower counts may drop. Follows with any other `via` (a starter pack, a list, or another account's collection) are unchanged, and nothing is deleted.

## 0.5.0

### Minor Changes

- [#63](https://github.com/hypercerts-org/api/pull/63) [`102293a`](https://github.com/hypercerts-org/api/commit/102293a9dcf86026e38f71356951bada7bd7bf76) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Organization queries (`getOrganization`, `getOrganizations`, `listOrganizations`, `searchOrganizations`) now return each organization's location record in `location` (the resolved view of the strong reference at `organization.record.location`, which is unchanged), so you no longer need a second `getLocation` call. It is the location record exactly as stored, or `null` when the organization has no location or the record is not indexed.

## 0.4.0

### Minor Changes

- [#57](https://github.com/hypercerts-org/api/pull/57) [`3848180`](https://github.com/hypercerts-org/api/commit/384818048e536f72a7e74f83d06aa44b2dafe8ba) Thanks [@Kzoeps](https://github.com/Kzoeps)! - - `app.certified.badge.listBadgeAwards` accepts `includeTotal`. When it is `true`, the output includes `totalCount`: the number of award records matching all filters, before cursor and limit, not deduplicated. It is also returned on empty pages.

- [#54](https://github.com/hypercerts-org/api/pull/54) [`97c2d98`](https://github.com/hypercerts-org/api/commit/97c2d989e1ac5dcda17bd0b3399e0860135bf639) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Add `org.hypercerts.context.getCommentCounts`, which returns comment counts for up to 100 subject records in one call.

  `getEntityFollows` and `getActorReactions` now reject subject URIs whose DID has a malformed `%` escape, as `getReactionCounts` already did, instead of returning null for them.

- [#58](https://github.com/hypercerts-org/api/pull/58) [`45137f2`](https://github.com/hypercerts-org/api/commit/45137f271c07db3ca20ad06d051f66d0d1178033) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Add `app.certified.graph.getFollowerCounts`, which returns follower counts for up to 100 account DIDs and entity AT-URIs in one call.

### Patch Changes

- [#51](https://github.com/hypercerts-org/api/pull/51) [`53cfff5`](https://github.com/hypercerts-org/api/commit/53cfff59afc0fb0a32f7e081b187e3b0d55a0084) Thanks [@holkexyz](https://github.com/holkexyz)! - License: the bundle is now licensed under either MIT or Apache-2.0, at your option. It was MIT only; earlier releases stay MIT.

## 0.3.0

### Minor Changes

- [#43](https://github.com/hypercerts-org/api/pull/43) [`9328ee5`](https://github.com/hypercerts-org/api/commit/9328ee568c369eefba41976ccf533790c4c90805) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Add `app.certified.feed.getActorReactions` to return an actor's indexed likes and reposts for up to 100 subject records in one request, preserving request order and duplicates.

- [#42](https://github.com/hypercerts-org/api/pull/42) [`3ad86a8`](https://github.com/hypercerts-org/api/commit/3ad86a8691736d03e647673a285469a59db7c45f) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Clients can check multiple actor or entity follow relationships in one request. The new batch queries return one explicitly keyed result for each supplied target, preserving request order and duplicates; null means no indexed relationship, while lookup failures remain errors.

- [#40](https://github.com/hypercerts-org/api/pull/40) [`51b2ed2`](https://github.com/hypercerts-org/api/commit/51b2ed29d5a91b38879cc79f7ba7d209da3166a3) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Add a public query that returns like and repost counts for up to 100 subject records at a time.

- [#41](https://github.com/hypercerts-org/api/pull/41) [`98825dd`](https://github.com/hypercerts-org/api/commit/98825dd56d6eed734d96aa64e25c6bcdf3fb825a) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Entity follower results now include `totalCount`, the number of distinct actor–entity relationships before pagination. The count is also returned when a page has no followers.

- [#46](https://github.com/hypercerts-org/api/pull/46) [`b6ae142`](https://github.com/hypercerts-org/api/commit/b6ae142e3ca66f8d16e599065f794782d400c8ec) Thanks [@kristoferlund](https://github.com/kristoferlund)! - Validate records against `@hypercerts-org/lexicon` 1.6.0 (was 1.5.0). Records may now carry the optional `langs` field and `app.certified.signature.defs#createdVia` signatures, and funding receipts may omit `amount` and `currency`. Records using these are accepted and served unchanged; no record that validated before is rejected. Operators must reinstall the bundle for the running indexer to use the new Lexicons.

### Patch Changes

- [#45](https://github.com/hypercerts-org/api/pull/45) [`8e080e4`](https://github.com/hypercerts-org/api/commit/8e080e4b9f09ebb3ee8d33df6fffc58e05beec58) Thanks [@kristoferlund](https://github.com/kristoferlund)! - Rename the package from `@hypercerts-org/hypercerts-api` to `@hypercerts-org/happyview-modules`, and its directory from `api/` to `happyview-modules/`, so the name says what it is and `@hypercerts-org/api` is free for the TypeScript package. Release tags from this release on are `@hypercerts-org/happyview-modules@X.Y.Z`; earlier releases keep their `@hypercerts-org/hypercerts-api@X.Y.Z` tags. The installer is run from `happyview-modules/` instead of `api/`; the modules themselves are unchanged.

## 0.2.0

### Minor Changes

- [#37](https://github.com/hypercerts-org/api/pull/37) [`a80279d`](https://github.com/hypercerts-org/api/commit/a80279d17fee926425ab18337c75a0eac160763f) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Add public queries for actors who liked or reposted a record and for an actor's own likes and reposts. Subject queries include distinct-actor totals; all four queries support bounded pagination.

### Patch Changes

- [#33](https://github.com/hypercerts-org/api/pull/33) [`9184a3c`](https://github.com/hypercerts-org/api/commit/9184a3c1999156097379c7d40d951846ba6140d1) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Activity responses now tolerate legacy contributor URI strings without failing hydration. The original activity record is preserved, while those strings are omitted from the hydrated `contributors` projection.

- [#34](https://github.com/hypercerts-org/api/pull/34) [`57728aa`](https://github.com/hypercerts-org/api/commit/57728aae26a8585483dd935d46cc3384aa77d6d6) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Badge award filters and response status lookups now recognize DID-object recipients while retaining record-subject and legacy DID matching.

- [#36](https://github.com/hypercerts-org/api/pull/36) [`c28d77a`](https://github.com/hypercerts-org/api/commit/c28d77a16004005ef0bcc0fc7db6be56da1cc88f) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Query endpoints now accept DID values consistently, including percent characters that are not followed by two hexadecimal digits. EVM-link queries also accept otherwise-valid DIDs with empty colon-separated segments.

- [#28](https://github.com/hypercerts-org/api/pull/28) [`e5847ae`](https://github.com/hypercerts-org/api/commit/e5847ae9f46a611c5000ccc66f70031137c2a4a6) Thanks [@Kzoeps](https://github.com/Kzoeps)! - The installer now verifies assets after write errors and avoids false failures when a successful response body is interrupted.

- [#28](https://github.com/hypercerts-org/api/pull/28) [`93d3502`](https://github.com/hypercerts-org/api/commit/93d350213bea703de61d82b0b07ee5576f02e4e5) Thanks [@Kzoeps](https://github.com/Kzoeps)! - `pnpm install:api` now shows compact progress for asset checks and required installs while keeping its final JSON summary on stdout.

- [#38](https://github.com/hypercerts-org/api/pull/38) [`4284d24`](https://github.com/hypercerts-org/api/commit/4284d24b29cbb852db1944b604806a28e89d38e8) Thanks [@Kzoeps](https://github.com/Kzoeps)! - Evaluation lookups and lists now retain records with malformed evaluator entries. The original record is preserved, while invalid entries are omitted from the hydrated evaluator projection. Records with more than 1,000 raw evaluator entries remain outside the supported limit.

## 0.1.0

The first release provides public, read-only HappyView queries for:

- **Actors:** profiles, organizations, and actor/entity follows.
- **Hypercerts:** activities, collections and items, contributions, and contributor information.
- **Context:** evaluations, attachments, acknowledgements, and measurements.
- **Funding and badges:** receipts, badge definitions, awards, and responses.
- **Discovery:** work-scope and vocabulary tags, locations, features, and EVM links.

The bundle includes shared Lexicons, installer/build tooling, and offline checks. It is distributed as tagged source for HappyView operators—not as an npm package or automatic deployment. See `api/README.md` for endpoint details.
