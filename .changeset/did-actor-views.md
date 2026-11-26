---
"@hypercerts-org/happyview-modules": minor
---

Look up indexed actor profiles, organizations, and primary locations by DID with `app.certified.actor.getActor` and `getActors`. Batch results keep input order and duplicates. `getActor` makes one best-effort handle lookup and includes the handle when it succeeds; `getActors` makes no resolver calls and omits handles. Existing organization responses are unchanged.
