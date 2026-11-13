---
'@hypercerts-org/happyview-modules': minor
'@hypercerts-org/api': minor
---

Organization queries (`getOrganization`, `getOrganizations`, `listOrganizations`, `searchOrganizations`) now return each organization's location record in `location` (the resolved view of `organization.location`, which stays a strong reference), so you no longer need a second `getLocation` call. It is the location record exactly as stored, or `null` when the organization has no location or the record is not indexed.
