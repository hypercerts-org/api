---
'@hypercerts-org/happyview-modules': patch
'@hypercerts-org/api': minor
---

Query definitions now state what the API already does: `limit` defaults to 25 and `sortDirection` to `desc`, `getLocation` documents its `InvalidRequest` error, and `indexedAt` on location and evaluation results can be null.

Client type changes (no wire change):
- `indexedAt` on `locationView` and `evaluationView` is now `string | null`; handle null if you read it.
- On list endpoints with new defaults, `$Params` now describes parsed params, so `limit` and `sortDirection` are required there. `client.call(..., {})` still compiles. If you annotate request objects with `$Params` and omit those keys, use `l.InferInput<typeof $params>` instead.
