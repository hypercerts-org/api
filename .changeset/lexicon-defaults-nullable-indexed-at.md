---
'@hypercerts-org/happyview-modules': patch
'@hypercerts-org/api': patch
---

Query definitions now state what the API already does: `limit` defaults to 25 and `sortDirection` to `desc`, `getLocation` documents its `InvalidRequest` error, and `indexedAt` on location and evaluation results can be null. In the generated client types, `indexedAt` on `locationView` and `evaluationView` is now `string | null`; handle null if you read it.
