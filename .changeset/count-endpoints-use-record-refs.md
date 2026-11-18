---
'@hypercerts-org/happyview-modules': patch
---

`getReactionCounts`, `getCommentCounts` and `getFollowerCounts` (for entity subjects) now look counts up in HappyView's record-reference table instead of scanning every like, repost, comment or follow, so they stay fast as those collections grow. Responses and errors are unchanged. Counts are only as complete as that table: a record whose references were never written is not counted, so check the table is complete before deploying.
