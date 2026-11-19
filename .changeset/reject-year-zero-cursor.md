---
'@hypercerts-org/happyview-modules': patch
---

A list request whose `cursor` or `before` timestamp is in year 0000 now returns an `InvalidRequest` error. Several endpoints used to answer it with an HTTP 500. `listVocabTags` now reports this as "cursor is malformed".
