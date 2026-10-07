# Endpoint map: choose by consumer task

This task index lists the 55 public query NSIDs in the bundled [OpenAPI contract](openapi.json). It helps choose an operation but does not replace its exact contract: inspect that operation and its referenced schemas for required parameters, types, defaults, limits, filter semantics, response fields, and declared errors. The static snapshot describes the contract, not availability or freshness on a selected deployment.

## Fast selection rules

- **One known record or relationship:** choose its `get...` query and supply the exact documented identifier. Profile lookup is a special case: `getProfile` accepts a DID or handle; most record getters take an AT-URI.
- **Known actor DIDs in a batch:** prefer `getProfiles` or `getOrganizations`; batch results may have nullable per-actor values. Their batch inputs are DIDs, not handles.
- **Browse or filter without free text:** choose `list...` in the relevant domain.
- **Text discovery:** use `search...` only where listed below. A search query is not interchangeable with a list filter, and search semantics vary by endpoint.
- **Relationship checks:** use `get...Follow` for a single pair; list queries answer who follows whom or which entities an actor follows.

Inspect the exact operation in the bundled OpenAPI contract before constructing a request: names such as `authors`, `actors`, `uri`, and `collection` have endpoint-specific meanings. Do not infer that a filter, search operation, output array name, or error exists just because a related endpoint has one.

## People and organization context (8)

| User task | Query NSID | Practical choice |
|---|---|---|
| Load one Certified profile | `app.certified.actor.getProfile` | `actor` is one DID or handle. Handle resolution is part of this operation. |
| Load profiles for known actors | `app.certified.actor.getProfiles` | `actors` is a repeated array of DIDs; each result corresponds to an input occurrence and its profile may be null. |
| Browse indexed profiles | `app.certified.actor.listProfiles` | Use for paged discovery, not free-text search. |
| Find profiles by text | `app.certified.actor.searchProfiles` | `search` is required; optionally constrain by actor DIDs. Check this endpoint's text/filter rules. |
| Load one actor's organization sidecar | `app.certified.actor.getOrganization` | `actor` is a DID. If no indexed sidecar exists, this single lookup declares `RecordNotFound`; unlike `getOrganizations`, it does not return a nullable organization per actor. |
| Load organization context for known actors | `app.certified.actor.getOrganizations` | `actors` is a repeated DID array; results preserve request order and an absent organization is null per result. |
| Browse/filter organizations | `app.certified.actor.listOrganizations` | Use for organization-type/visibility filters and pagination. |
| Find organizations by text | `app.certified.actor.searchOrganizations` | Searches associated profile text, with optional organization filters. |

Use `getProfiles`/`getOrganizations` for known DID sets; use `list` or `search` for discovery. A missing optional profile inside an organization view is not the same as a missing organization record.

## Activities, contributors, contributions, and rights (9)

| User task | Query NSID | Practical choice |
|---|---|---|
| Load one activity | `org.hypercerts.claim.getActivity` | Exact activity AT-URI in `uri`; hydrated activity view. |
| Filter/browse activities | `org.hypercerts.claim.listActivities` | Use structured filters such as authors, contributors, involved actors, or exact activity URIs; no text query is required. |
| Search activities by text | `org.hypercerts.claim.searchActivities` | `search` is required; current contract describes a case-insensitive literal substring of title or short description. |
| Load one contribution | `org.hypercerts.claim.getContribution` | Exact record AT-URI in `uri`. |
| List contributions | `org.hypercerts.claim.listContributions` | Browse/filter by publisher DID. |
| Load one contributor-information record | `org.hypercerts.claim.getContributorInformation` | Exact record AT-URI in `uri`. |
| List contributor-information records | `org.hypercerts.claim.listContributorInformation` | Browse with an optional publisher-DID filter. |
| Load one rights record | `org.hypercerts.claim.getRights` | Exact DID-authority record AT-URI in `uri`. |
| List rights records | `org.hypercerts.claim.listRights` | Browse with an optional publisher-DID filter. |

For activities, distinguish repository-owner `authors` from `contributors`; `involvedActors` has its own documented meaning. Check array combination and search behavior in the exact operation.

## Collections and their contents (4)

| User task | Query NSID | Practical choice |
|---|---|---|
| Load one collection | `org.hypercerts.collection.getCollection` | Exact collection AT-URI in `uri`; hydrates selected related projections. |
| Find collections by filters | `org.hypercerts.collection.listCollections` | Use filters such as author, collection URI, item URI, or tag URI. Some URI filters intentionally ignore CID; inspect the contract. |
| Find collections by text | `org.hypercerts.collection.searchCollections` | `search` is required; current contract searches title/short description. Other filters still apply. |
| Resolve embedded collection items | `org.hypercerts.collection.listCollectionItems` | Pass the collection AT-URI. Resolves each embedded strong reference by exact URI+CID, one level deep; see [the collection recipe](recipes.md#load-exact-collection-item-versions). |

Choose `listCollectionItems` when the caller needs the referenced item versions, not just collections matching an `itemUris` discovery filter.

## Badges and recipient responses (7)

| User task | Query NSID | Practical choice |
|---|---|---|
| Load one badge definition | `app.certified.badge.getBadgeDefinition` | Exact definition AT-URI in `uri`. |
| Browse/filter badge definitions | `app.certified.badge.listBadgeDefinitions` | Use publisher/type filters and pagination. |
| Search badge definitions | `app.certified.badge.searchBadgeDefinitions` | `search` is required; use for text discovery, not status checking. |
| Load one award and its response status | `app.certified.badge.getBadgeAward` | Exact award AT-URI in `uri`; includes `responseStatus` (`accepted`, `rejected`, or `unanswered`) and nullable recipient response. |
| Browse/filter awards | `app.certified.badge.listBadgeAwards` | Use when the award URI is not known or multiple awards are needed; the result includes response status. |
| Load one raw response record | `app.certified.badge.getBadgeResponse` | Exact response AT-URI in `uri`. |
| List raw responses for an award | `app.certified.badge.listBadgeResponses` | Optional `badgeAward` filter; use to inspect response records, not as a substitute for the award's derived status. |

An `unanswered` award is a successful indexed award result, not a not-found response. See [the badge recipe](recipes.md#read-badge-award-response-status).

## Follow relationships (7)

| User task | Query NSID | Practical choice |
|---|---|---|
| Check one actor-to-actor follow | `app.certified.graph.getFollow` | Supply actor and subject DIDs; the representative `follow` may be null when none is indexed. |
| List an actor's followers | `app.certified.graph.listActorFollowers` | `actor` is the followed actor DID. |
| List actors an actor follows | `app.certified.graph.listActorFollowing` | `actor` is the follower DID. |
| Check one actor-to-entity follow | `app.certified.graph.getEntityFollow` | Supply actor DID and entity AT-URI; check its nullable/error contract. |
| List actors following an entity | `app.certified.graph.listEntityFollowers` | `entity` is an entity AT-URI. |
| List entities an actor follows | `app.certified.graph.listEntityFollowing` | `actor` is an actor DID; targets are hydrated from indexed records. |
| Browse recent raw follow records | `app.certified.graph.listRecentFollows` | Beta feed across publishers; `before` and pagination have distinct feed semantics. Not a per-actor relationship check. |

Do not confuse actor follows with entity follows; their identifiers and list outputs differ. Recent raw follows preserve duplicates and are not a snapshot; consult that endpoint's description before using cursors.

## Context and supporting records (8)

| User task | Query NSID | Practical choice |
|---|---|---|
| Load one acknowledgement | `org.hypercerts.context.getAcknowledgement` | Exact record AT-URI in `uri`. |
| List acknowledgements | `org.hypercerts.context.listAcknowledgements` | Filter by publisher or subject as documented. |
| Load one attachment | `org.hypercerts.context.getAttachment` | Exact record AT-URI in `uri`. |
| List attachments | `org.hypercerts.context.listAttachments` | Filter by publisher, record URI, subject, or content type. |
| Load one evaluation | `org.hypercerts.context.getEvaluation` | Exact record AT-URI in `uri`; includes publisher/evaluator projections. |
| List evaluations | `org.hypercerts.context.listEvaluations` | Filter by publisher, evaluator, or subject. |
| Load one measurement | `org.hypercerts.context.getMeasurement` | Exact record AT-URI in `uri`. |
| List measurements | `org.hypercerts.context.listMeasurements` | Filter by publisher or subject. |

These records are context related to other Hypercert records, not alternate activity or collection search endpoints. Confirm whether each filter expects a DID or AT-URI.

## Locations, features, and EVM links (6)

| User task | Query NSID | Practical choice |
|---|---|---|
| Load one location | `app.certified.location.getLocation` | Exact location AT-URI in `uri`. |
| List/filter locations | `app.certified.location.listLocations` | Filter by publisher, URI, or location type. |
| Load one feature | `org.hypercerts.entity.getFeature` | Exact feature AT-URI in `uri`; includes author hydration. |
| List/filter features | `org.hypercerts.entity.listFeatures` | Use publisher, organization-record, or type filters. |
| Load one EVM link | `app.certified.link.getEvmLink` | Exact EVM-link AT-URI in `uri`. |
| List EVM links | `app.certified.link.listEvmLinks` | Filter by actor DID or wallet address. |

## Funding receipts and controlled tags (6)

| User task | Query NSID | Practical choice |
|---|---|---|
| Load one funding receipt | `org.hypercerts.funding.getReceipt` | Exact receipt AT-URI in `uri`. |
| Find/list funding receipts | `org.hypercerts.funding.listReceipts` | Combine the documented publisher, URI, from/to, related-record, or transaction filters. |
| Load one vocabulary tag | `org.hypercerts.vocab.getVocabTag` | Exact tag AT-URI in `uri`. |
| List vocabulary tags | `org.hypercerts.vocab.listVocabTags` | Browse by publisher DID. |
| Load one work-scope tag | `org.hypercerts.workscope.getWorkscopeTag` | Exact tag AT-URI in `uri`. |
| List work-scope tags | `org.hypercerts.workscope.listWorkscopeTags` | Browse by publisher DID. |

Use the specific tag family required by the calling record. Similar-looking tags are separate record families and are not interchangeable.
