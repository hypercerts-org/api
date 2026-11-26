---
'@hypercerts-org/happyview-modules': patch
---

List endpoints now check paging cursors and repeated parameters the same way everywhere. A cursor that is empty or longer than 8192 characters is rejected with `cursor is malformed`; cursors the API returns are always shorter, so normal paging is unaffected. Repeated filters such as `authors` that arrive in an unexpected shape now fail with `<name> must use repeated query values` on every endpoint; HappyView already rejects those spellings before this check, so requests behave as before.
