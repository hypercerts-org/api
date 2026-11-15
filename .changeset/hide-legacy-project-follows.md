---
'@hypercerts-org/happyview-modules': patch
'@hypercerts-org/api': patch
---

Follower counts and follow lists no longer include old project follows saved as account follows.

Some apps followed a project by saving an account follow whose `via` points to the followed organization's own collection. Those records are now ignored by `getFollow`, `getFollows`, `listActorFollowers`, `listActorFollowing`, `getFollowerCounts` and `listRecentFollows`, so organization follower counts may drop. Follows with any other `via` (a starter pack, a list, or another account's collection) are unchanged, and nothing is deleted.
