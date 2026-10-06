---
'@hypercerts-org/hypercerts-api': patch
---

Collection list and search results now omit malformed location and tag projections instead of failing the whole page. Collection rows, original records, and pagination cursors are preserved. `getCollection` continues to reject malformed references.
