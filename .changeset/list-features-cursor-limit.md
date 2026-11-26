---
'@hypercerts-org/happyview-modules': patch
'@hypercerts-org/api': patch
---

`listFeatures` now documents the same 8192-character cursor limit as the other list endpoints (it said 32768). Cursors the API returns are far shorter, so paging is unaffected.
