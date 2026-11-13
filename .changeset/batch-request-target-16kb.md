---
'@hypercerts-org/happyview-modules': patch
'@hypercerts-org/api': patch
---

Batch queries now accept 100 typical record links in one request.

The limit on the encoded request URL path and query for `getFollows`, `getEntityFollows`, `getFollowerCounts` and `getCommentCounts` rises from 7,000 to 16,384 bytes. `getReactionCounts` and `getActorReactions` now enforce the same limit. Requests over the limit are still rejected with an `InvalidRequest` message, returned as HTTP 500 by the current HappyView release.
