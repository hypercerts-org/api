---
'@hypercerts-org/hypercerts-api': patch
---

Activity responses now tolerate legacy contributor URI strings without failing hydration. The original activity record is preserved, while those strings are omitted from the hydrated `contributors` projection.
