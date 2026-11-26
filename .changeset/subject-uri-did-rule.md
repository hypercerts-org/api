---
"@hypercerts-org/happyview-modules": patch
---

Record subject AT-URIs in `getCommentCounts`, `getReactionCounts`, `getFollowerCounts`, `getEntityFollows` and `getActorReactions` now use the same DID check as other queries. A DID with an opaque percent sequence such as `%GG` is accepted instead of rejected.
