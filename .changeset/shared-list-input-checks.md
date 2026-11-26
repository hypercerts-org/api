---
'@hypercerts-org/happyview-modules': patch
---

Paging cursors are now checked the same way on every list endpoint. A cursor that is empty or longer than 8192 characters is rejected with `cursor is malformed`; cursors the API returns are always shorter, so normal paging is unaffected.
