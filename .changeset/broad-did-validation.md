---
'@hypercerts-org/hypercerts-api': patch
---

Query endpoints now accept DID values consistently, including percent characters that are not followed by two hexadecimal digits. EVM-link queries also accept otherwise-valid DIDs with empty colon-separated segments.
