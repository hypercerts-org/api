---
'@hypercerts-org/hypercerts-api': minor
---

Add lookups and paginated lists for actor and entity follows, plus a recent-follows feed combining both record types. Outgoing entity-follow results can resolve indexed activity, collection, or feature targets; the recent feed preserves duplicate records and is intended for recent activity, not lossless ingestion or backfill.
