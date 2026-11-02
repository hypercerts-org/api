---
'@hypercerts-org/happyview-modules': patch
---

Rename the package from `@hypercerts-org/hypercerts-api` to `@hypercerts-org/happyview-modules`, and its directory from `api/` to `happyview-modules/`, so the name says what it is and `@hypercerts-org/api` is free for the TypeScript package. Release tags from this release on are `@hypercerts-org/happyview-modules@X.Y.Z`; earlier releases keep their `@hypercerts-org/hypercerts-api@X.Y.Z` tags. The installer is run from `happyview-modules/` instead of `api/`; the modules themselves are unchanged.
