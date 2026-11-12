---
'@hypercerts-org/happyview-modules': minor
'@hypercerts-org/api': minor
---

Organization queries (`getOrganization`, `getOrganizations`, `listOrganizations`, `searchOrganizations`) now return each organization's primary location in `primaryLocation`, so you no longer need a second `getLocation` call. It is the location record exactly as stored, or `null` when the organization has no location or the record is not indexed.
