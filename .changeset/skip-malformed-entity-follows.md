---
'@hypercerts-org/hypercerts-api': patch
---

Entity-following pages now skip follows with missing or malformed target URIs instead of failing the whole request, and continue scanning to fill the page. Valid targets the API does not support remain listed with a null entity.
