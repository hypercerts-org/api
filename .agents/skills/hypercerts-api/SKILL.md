---
name: hypercerts-api
description: Use whenever a user needs to call Hypercerts' public, read-only XRPC API directly; select an endpoint from the bundled contract, construct GET requests, paginate, and interpret indexed results from production or staging.
---
Production: https://api.hypercerts.dev
Staging: https://api.staging.hypercerts.dev

# Consuming the Hypercerts API

This skill covers only the public, read-only HappyView XRPC query API. Every query is `GET /xrpc/<full NSID>` on the selected base URL. Requests need no authentication: do not add OAuth, login, bearer tokens, or API keys. This API does not provide writes.

## Route by task

- Choosing an endpoint or filter for a user task: [endpoint-map.md](references/endpoint-map.md).
- Planning a multi-call integration flow: [recipes.md](references/recipes.md).
- Building URLs, encoding arrays and filters, or continuing pages: [request-patterns.md](references/request-patterns.md).
- Distinguishing identities and versions, or handling stale, missing, nullable, or failed data: [reliability.md](references/reliability.md).

Read the relevant reference, then inspect the exact operation in the [bundled OpenAPI contract](references/openapi.json) before constructing a request. Do not assume parameter names, array semantics, defaults, limits, cursor behavior, nullability, or errors are shared across endpoints. Use that operation's own parameters, schemas, descriptions, and declared errors.

## Bundled API contract

- [`references/openapi.json`](references/openapi.json) is a self-contained snapshot of all 55 query operations, including parameters, response schemas, declared XRPC errors, and their referenced schema definitions. The included contract makes the skill self-contained when installed separately.
- To inspect an exact contract, find `/xrpc/<full NSID>` in the snapshot, read its operation, and follow any `#/components/schemas/...` references by schema name. Each operation and schema is stored on its own line for focused lookup.
- The snapshot describes declared behavior, not endpoint availability or data freshness on a particular host. Its OpenAPI `info.version` is not the deployed server's version.
- Use the API directly when a task needs live indexed results. Do not send extra diagnostic probes just to validate deployment; a deployment-specific availability check requires explicit approval for the target.
