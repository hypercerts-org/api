# HappyView API toolkit and query modules

This package owns the shared API installer and build tooling, pinned upstream Lexicons, common view definitions, reusable Lua projections, test utilities, and independently registered capability modules. The aggregate [`manifest.json`](manifest.json) selects the modules included in this checkout; module manifests declare their assets and dependencies.

## Endpoint reference

Use the [`docs/` endpoint explorer](../docs/) and generated [OpenAPI reference](../docs/openapi.json) for endpoint names and contracts. The [coverage report](../docs/coverage.json) lists manifest-registered operations; inclusion does not imply runtime or deployment validation. See [docs/README.md](../docs/README.md) to run the explorer locally and refresh its committed reference.

## Graph follow capability

`modules/actor-follow/manifest.json` provides `app.certified.graph.getFollows` for checking up to 100 subject DIDs against one actor. `modules/entity-follow/manifest.json` provides `app.certified.graph.getEntityFollows` for checking up to 100 entity AT-URIs against one actor. Supply targets as repeated query parameters; both queries preserve every input position and duplicate, return the original target beside its raw nullable representative, and reject the whole request when any target is invalid. The encoded GET request-target is bounded to 16,384 bytes. A null follow means no indexed relationship; database failures remain errors.

Account-follow queries (`getFollow`, `getFollows`, `listActorFollowers`, `listActorFollowing`, `getFollowerCounts`, and the account records in `listRecentFollows`) share one filter, `lua/shared/accountFollowFilter.lua`, that skips legacy project follows: an `app.certified.graph.follow` whose `via` is a strongRef to an `org.hypercerts.collection` owned by the same DID as `subject`. Those clients used an account follow to follow a project; project follows belong in `app.certified.graph.entityFollow`. The records stay in the database and the filter runs at query time. A `via` that points to a starter pack, list, or a collection owned by another DID is kept. It runs before per-relationship deduplication, so a user who also has a genuine follow of the same account is still counted once. `entityFollow` queries are unchanged.

`modules/follower-counts/manifest.json` provides `app.certified.graph.getFollowerCounts`, which counts followers for 1–100 subjects in one statement. Subjects mix account DIDs, counted from `app.certified.graph.follow`, and entity AT-URIs, counted from `app.certified.graph.entityFollow`. Each count is the number of distinct indexed publishers, which equals the `totalCount` of `listActorFollowers` for that subject, and of `listEntityFollowers` as long as `happyview_record_refs` is complete for the entity follows (a follow whose refs row was never written is not counted). Results keep input order and duplicates, and unfollowed subjects count zero. Entity URIs are found through HappyView's `happyview_record_refs` index (see the feed-reactions section); account DIDs are not `at://` strings, so they still read the follow collection.

## Feed reaction capability

`modules/feed-reactions/manifest.json` owns the like and repost record schemas and six public queries: `app.certified.feed.getLikes`, `getReposts`, `getActorLikes`, `getActorReposts`, `getActorReactions`, and `getReactionCounts`. The root manifest includes this independently installable module in the aggregate bundle. Its record schemas enable backfill, and queries read the current indexed records directly; deleted reactions therefore stop appearing once removed from HappyView's index, without a separate stored count.

Subject queries match by AT-URI without requiring a subject CID match, return one earliest reaction per author, and include a distinct-actor total with nullable profile and organization sidecars. Actor list queries return raw reaction records without subject hydration. `getActorReactions` looks up one actor's like and repost across 1–100 subject AT-URIs, preserving input order and duplicates; each raw reaction view retains its record URI, and a missing indexed reaction is null. Query failures return errors, not nulls. The four list queries use bounded `createdAt`/URI cursor pagination; the batch lookup is not paginated.

`getReactionCounts` and `getActorReactions` accept 1–100 repeated, unbracketed `subjects` values within the same 16,384-byte encoded request-target bound. `getReactionCounts` returns one ordered count pair per input occurrence, counting distinct indexed publisher DIDs by subject URI across both reaction collections. Its counts do not require the subject record to be indexed and may change as reaction indexing changes. Like and repost counts, comment counts and entity-follower counts are looked up in HappyView's `happyview_record_refs` table (shared helper `lua/shared/reactionCounts.lua`), then re-checked against the record's `subject.uri` or `subjects[].uri`, so a like found `via` a repost does not count on that repost. They are only as complete as `happyview_record_refs`: a record whose refs row was never written is not counted.

## Comment counts

`modules/context-attachments/manifest.json` also provides `org.hypercerts.context.getCommentCounts`. A comment is an `org.hypercerts.context.attachment` with `contentType` `comment` whose `subjects` point at the record it comments on. The query accepts 1–100 repeated subject AT-URIs and counts, per subject, the current comment records whose `subjects[].uri` matches, ignoring CID. It counts records rather than authors, so a comment that lists a subject twice counts once while two comments by one author count twice. Results keep input order and duplicates, and the subject need not be indexed.

## Local validation

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
PSQL_PATH="$(command -v psql)" pnpm test:http
```

`pnpm check` validates generated-source freshness, lint, types, API unit tests, and endpoint explorer tests. `pnpm build` refreshes declared Lua bundles and builds the endpoint explorer. HTTP tests require Docker Compose, `psql`, and the pinned PostgreSQL and HappyView images already cached locally. They use a task-owned disposable project and database; the Compose bridge network permits egress and is not network-level isolation. See [CONTRIBUTING.md](../CONTRIBUTING.md) for test coverage and safety details.

## Install a released API bundle

Releases version the installable API bundle in this package; they do not publish to npm or deploy to a HappyView instance. GitHub Releases and tagged source archives are the distribution channel. Choose an `@hypercerts-org/happyview-modules@X.Y.Z` release tag (releases up to 0.2.0, before the package was renamed, are tagged `@hypercerts-org/hypercerts-api@X.Y.Z`), clone that snapshot, install its pinned dependencies from the repository root, then run the installer from `happyview-modules/`:

```sh
git clone --depth 1 --branch '@hypercerts-org/happyview-modules@X.Y.Z' https://github.com/hypercerts-org/api.git hypercerts-api
cd hypercerts-api
pnpm install --frozen-lockfile
cd happyview-modules
HYPERCERTS_HANDLE_RESOLVER_URL='https://resolver.example' \
HAPPYVIEW_BASE_URL='https://your-happyview.example' \
HAPPYVIEW_ADMIN_TOKEN='<scoped-admin-token>' \
pnpm install:api
```

For bundles that register `app.certified.actor.getProfile`, handle lookups require `HYPERCERTS_HANDLE_RESOLVER_URL` to be an HTTPS origin without credentials, path, query, or fragment. Interactive installs prompt when it is absent; noninteractive installs must set it. The admin token needs `script-variables:read`, and `script-variables:create` if the installer must create the setting. Existing settings are retained; HappyView exposes only a masked preview, so the installer cannot verify the configured value. See [CONTRIBUTING.md](../CONTRIBUTING.md) for release-note requirements and installer safety details.

## Deploys

Pushing to `main`, `staging` or `production` runs [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml), which installs this bundle into the matching environment's HappyView with `pnpm install:api --override`, so assets that differ from this repository are replaced (the repository is the source of truth). Branches map to GitHub environments explicitly:

| Branch       | GitHub environment |
| ------------ | ------------------ |
| `main`       | `Test`             |
| `staging`    | `Staging`          |
| `production` | `Production`       |

Each environment must allow deployments from its branch and define its own values; never reuse a token across environments:

- variable `HAPPYVIEW_BASE_URL`: that environment's HappyView origin
- secret `HAPPYVIEW_ADMIN_TOKEN`: a scoped admin token for that HappyView, including `script-variables:read`
- variable `HYPERCERTS_HANDLE_RESOLVER_URL`: needed only if that HappyView does not already have this setting; the token then also needs `script-variables:create`

Pushes that only change docs, tests or tooling skip the deploy (`paths-ignore` in `deploy.yml`). To deploy by hand, run the workflow with `workflow_dispatch`: choose the environment, run it from that environment's branch, and optionally give a rollback commit SHA, which must be on that branch. A smoke step runs after every install, in the same deploy job, and checks the live API.

Deploys to each environment run one at a time and are never cancelled midway; deploys to different environments do not block each other.
