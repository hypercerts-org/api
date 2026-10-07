---
'@hypercerts-org/hypercerts-api': patch
---

Evaluation lookups and lists now retain records with malformed evaluator entries. The original record is preserved, while invalid entries are omitted from the hydrated evaluator projection. Records with more than 1,000 raw evaluator entries remain outside the supported limit.
