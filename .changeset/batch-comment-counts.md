---
'@hypercerts-org/happyview-modules': minor
'@hypercerts-org/api': minor
---

Add `org.hypercerts.context.getCommentCounts`, which returns comment counts for up to 100 subject records in one call.

`getEntityFollows` and `getActorReactions` now reject subject URIs whose DID has a malformed `%` escape, as `getReactionCounts` already did, instead of returning null for them.
