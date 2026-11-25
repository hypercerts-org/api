---
"@hypercerts-org/api": major
---

Added DID-only `app.certified.actor.getActor` and `getActors` queries.

Replace `app.certified.actor.getOrganization.OrganizationActorView` with `org.hypercerts.api.defs.ActorView` and import `LocationRecordView` from the same shared namespace. Narrow `actor.organization` before accessing it: the shared TypeScript type allows null even though existing organization queries keep their response shapes.
