---
"@hypercerts-org/happyview-modules": minor
---

Look up indexed actor profiles, organizations, and primary locations by DID with `app.certified.actor.getActor` and `getActors`. Batch results keep input order and duplicates. A handle is included when lookup succeeds; batches attempt lookups for the first 50 distinct DIDs. Existing organization responses are unchanged.
