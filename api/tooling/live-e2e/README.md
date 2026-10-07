# Live API E2E suite

Run repeatable, read-only checks against a selected Hypercerts API deployment using records already indexed there. This captures the filter, pagination, and roundtrip approach of the production Herdr audit without requiring agents, production writes, or a seeded database.

From the repository root, install the pinned dependencies with `pnpm install --frozen-lockfile`. No new dependencies or lockfile changes are required.

## Choose a target and tests

List endpoints or inspect the complete test catalogue **without making requests**:

```sh
node api/tooling/live-e2e/cli.mjs --list
node api/tooling/live-e2e/cli.mjs --catalogue
node api/tooling/live-e2e/cli.mjs --catalogue \
  --endpoint org.hypercerts.claim.listActivities
```

The catalogue is generated from `api/manifest.json` and its module registrations, not all files in the Lexicon directory. This checkout lists 55 endpoints and 860 default cases, including 461 nonempty filter-presence shapes. These counts describe planned checks, not executed or positive coverage. Search endpoints include both unrestricted blank search and nonblank search combinations; this expands the original audit's shape inventory. Case IDs are stable endpoint NSIDs followed by a case name.

An explicit `--run`, `--target`, and `--budget` are required to contact any server:

```sh
# Example only: obtain approval for this target and request budget before running.
node api/tooling/live-e2e/cli.mjs --run \
  --target https://api.hypercerts.dev --budget 300 \
  --endpoint org.hypercerts.claim.listActivities \
  --endpoint app.certified.actor.searchProfiles
```

Omit `--endpoint` to select all registered endpoints. Repeat it to select several. A target may be an API origin or its `/xrpc` URL. Requests do not require credentials. Never point this runner at an admin endpoint or use it to install/seed records.

Selecting a lookup also permits GET requests to its discovery source, displayed by `--list` and `--catalogue`. Actor/entity relationships use `app.certified.graph.listRecentFollows`; embedded items use `org.hypercerts.collection.listCollections`. The badge-award relationship case additionally reads `app.certified.badge.listBadgeResponses`. It does not contact Hyperindex or upstream PDSes.

## Test catalogue

`catalogue.mjs` defines these case families; `--catalogue` enumerates every applicable endpoint/case pair with its assumptions and description.

| Case ID | Assertion and data requirement |
| --- | --- |
| `baseline` | HTTP 200 and minimum response structure. Full pinned Lexicon validation is recorded separately as a schema failure and does not by itself block semantic cases. Activities/profiles need at least two baseline records; other datasets need one. Sparse records are reported as gaps. |
| `roundtrip` | Discovered URI, CID, and raw record survive lookup. Actor batches preserve order and repeated actor occurrences. Graph lookups preserve the requested relationship, without assuming a recent raw follow is the deduplicated representative. |
| `filters/<names>` | Every nonempty subset of supported optional semantic filters, plus nonblank search where available. Predicates use returned raw fields; all selected filters are ANDed. A known-positive record must remain present. An empty result is never positive coverage. |
| `multi/<name>` | Two distinct real values use OR and retain known matches for both. **Exception:** collection `tagUris` requires all supplied tags (AND), including a known record containing both. |
| `value/<name>/<value>` | Each declared enum value, and both boolean values, has a positive anchor or an explicit gap. |
| `relationship/recipient-response` | Badge award status and recipient response match independently listed response history, with recipient-author and exact award URI/CID matching. Latest `indexedAt`, then URI, wins. Complete bounded response history is required. |
| `limit/1`, `limit/2`, `limit/default`, `limit/100` | Requested/default page bounds are respected. These can pass on an empty dataset and do not count as positive filter coverage. |
| `pagination/asc`, `pagination/desc` | Server-issued continuation, replay, and two small pages versus one larger slice; no duplicate identities and timestamp/URI ordering. Ascending exists only where supported. Embedded collection items preserve source order/multiplicity and exact resolved URI/CID. Requires a cursor. |
| `invalid/limit`, `invalid/cursor` | Sampled invalid requests produce named `InvalidRequest` with 4xx and no Lua traceback. The known runtime's HTTP 500 behavior is a **failure**, not an accepted workaround. |
| `traversal` | Opt-in scan reaches termination within the page cap; record identities are not duplicated. Embedded items are compared against source order and multiplicity. A remaining cursor means incomplete coverage. |

Graph relationship identity and ordering use the nested `follow` record rather than hydrated profile or organization sidecars. Evaluation filter anchors come only from object-shaped `record.evaluators[].did` entries; malformed legacy strings remain schema findings and do not establish positive coverage.

Response validation uses the pinned `@atproto/lexicon` validator. Record definitions are unwrapped to their object schemas because the SDK XRPC validator cannot traverse record-wrapper refs. JSON IPLD values are decoded for validation; retained raw evidence and semantic checks use the original JSON. Every 200 response gets a separate schema finding tied to the responding NSID and request evidence. Malformed optional record fields can remain discovery anchors when the fields used by that case are legal. A malformed first response or failed source request with no usable rows is a failed or unavailable source observation and blocks checks that need it. If a later continuation fails after usable rows were collected, the source is marked partial/incomplete with its cause and request evidence; those rows may still anchor dependent requests, but missing anchors are not treated as proven gaps and discovery is never marked complete.

## Assumptions and bounds

Discovery reads up to two 100-row pages per source and is cached per run. Filter scans use the same cap. Increase `--discovery-pages N` only within an approved request budget. If a continuation is unavailable or the page bound leaves a cursor, a source with usable rows is retained as `partial` with `complete: false`; downstream checks can use known anchors, while checks needing unseen anchors remain not-run. Rare values outside a complete bounded sample are gaps, not evidence that no records exist.

For profiles and activities, pagination and multi-value checks assume richer data. Evaluations, acknowledgements, features, and other sparse datasets have no fixed production fixture identities or large record-count assumptions. Missing positive anchors produce `insufficient-data`.

Full traversals are disabled by default:

```sh
# Example only: full traversals require a separately approved request budget.
node api/tooling/live-e2e/cli.mjs --run \
  --target https://api.hypercerts.dev --budget 500 \
  --endpoint app.certified.actor.listProfiles --full --max-pages 200
```

Live requests are serialized, spaced at least 1 second apart, use a 30-second timeout, and reject redirects. `--interval-ms` can increase pacing. Every started live request consumes budget, including failed transports, discovery, and negative probes. There are no retries; HTTP 429 stops further requests. Other API errors are retained as failures, while unrelated selected endpoints can continue within budget. Schema findings and failed shared-source observations also make the run fail. A partial source whose continuation actually failed (for example, HTTP 500) still retains its rows, but increments `sourceFailures` and exits 1; partial sources caused only by unavailable evidence, a stop, or the page bound remain incomplete and exit 2. Case outcomes remain attributed to the selected endpoint and are not multiplied for each dependent case.

Reads are not snapshot-isolated. A changing cursor replay, record CID, or slice comparison is a failed consistency assertion that needs investigation; it is not automatically proof of a server defect. Ordering checks become gaps if the response does not expose a usable timestamp and the actual database fallback is hidden.

## Offline replay

Replay a retained run without contacting any server:

```sh
node api/tooling/live-e2e/cli.mjs --replay /path/to/captured/evidence \
  --out /path/to/new/replay-output
```

The input must contain the original `plan.json` and numbered request artifacts. Replay matches the exact GET method, NSID, and decoded query parameters; repeated parameter values and their order are preserved, while percent-encoding differences such as `%20` versus an equivalent decoded space do not affect matching. It uses only the captured HTTP status and body. Missing or incomplete captures are `not-run` with an unavailable-evidence reason; they are never converted to data gaps, synthesized, or fetched. Reusing a capture for repeated identical evaluations is deterministic and marked in request evidence. Reports show zero live requests separately from replay evaluations and captured request sequences used. The source evidence is read-only; output must be a fresh directory. `--endpoint` may narrow replay to endpoints listed in the captured plan.

## Evidence and exit status

By default live evidence goes to `$XDG_STATE_HOME/hypercerts-live-e2e/<unique-run>` or `~/.local/state/hypercerts-live-e2e/<unique-run>`, outside the repository. `--out PATH` must name a **new** directory; existing evidence is never reused. Replay reads its input evidence directory without modification and also writes to a new output directory. Files have restrictive permissions and can contain public identities and record content.

- `plan.json`: target, approved budget, bounds, selected endpoints and cases.
- `000001.json`, etc.: exact GET URL, timestamps, status, headers, raw response body, and transport errors. A request record is persisted before network I/O.
- `cases.jsonl`: incremental outcomes and request sequence ranges.
- `report.json`, `report.md`: complete outcomes, `schemaFindings` tied to responding endpoints/request evidence, `sourceObservations` for shared discovery, selected/related request evidence per case, and separate live/replay counts.

Case outcomes are `passed`, `failed`, `insufficient-data`, or `not-run` (budget/rate-limit, source failure, incomplete discovery with no anchor, or unavailable replay evidence). Schema mismatches are separate `failed` findings. Shared-source observations are attributed once to their actual source endpoint and distinguish `available`, `partial`, `failed`, and `not-run`; a `partial` observation can still have `incompleteCause.status: failed` when a continuation request received an actual failure. The top-level `sourceFailures` count and exit status include that case even while the partial rows remain available to dependent cases. Reports keep positive filter cases separate from ordinary successful bound checks via case IDs.

Exit status is 0 with no failures or unexecuted cases; data gaps are allowed. Status 1 means failed assertions, schema findings, or failed source observations, including a failed continuation retained as a partial source. Status 2 means incomplete coverage from missing evidence, stopped requests, or a page-bound partial source, invalid invocation, or an operational error. `--strict-gaps` also makes data gaps exit 2. If both failures and gaps exist, failures take precedence.

An interrupted run retains the plan, started request records, and completed cases; it does not support resumption or guarantee a final report after interruption. Review these artifacts before starting a fresh run.

## Offline validation

```sh
node --test api/tests/unit/live-e2e*.test.js
pnpm test:unit
pnpm check
```

Runner tests use controlled transport replies; they make no external HTTP requests. Existing HTTP runtime suites remain the fixture-backed proof of endpoint behavior. This live suite complements them and does not seed or start Docker services.

## Remaining scope

Hyperindex parity is not implemented in this first runner. The previous audit's cross-index comparisons remain separate evidence. Adding parity requires an independently selected GraphQL target, explicit budget, aligned complete/bounded sets, and coverage-gap reporting; do not infer index agreement from XRPC-only passes.

The suite currently has no custom anchor-file input, report UI, or automatic resume. Use its JSON catalogue/report for tooling integrations. It is development tooling, not a change to installed handlers or API contracts.
