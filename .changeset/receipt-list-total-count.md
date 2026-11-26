---
"@hypercerts-org/happyview-modules": minor
"@hypercerts-org/api": minor
---

Set `includeTotal=true` on `org.hypercerts.funding.listReceipts` to get `totalCount`: the number of matching indexed receipts before pagination, even on an empty page. Omit the flag or set it to `false` to skip counting.
