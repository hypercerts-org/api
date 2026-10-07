# @hypercerts-org/hypercerts-api

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
