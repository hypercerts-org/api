---
'@hypercerts-org/happyview-modules': minor
'@hypercerts-org/api': minor
---

- `app.certified.badge.listBadgeAwards` accepts `includeTotal`. When it is `true`, the output includes `totalCount`: the number of award records matching all filters, before cursor and limit, not deduplicated. It is also returned on empty pages.
