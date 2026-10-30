---
'@hypercerts-org/happyview-modules': minor
---

Clients can check multiple actor or entity follow relationships in one request. The new batch queries return one explicitly keyed result for each supplied target, preserving request order and duplicates; null means no indexed relationship, while lookup failures remain errors.
