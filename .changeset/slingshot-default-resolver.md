---
"@hypercerts-org/happyview-modules": minor
"@hypercerts-org/api": patch
---

`app.certified.actor.getProfile` now resolves handles through `https://slingshot.microcosm.blue` when the HappyView script variable `HYPERCERTS_HANDLE_RESOLVER_URL` is unset. A valid value still overrides it; an invalid value still fails with `HandleResolverConfigError`. `pnpm install:api` no longer prompts for, reads or creates that variable, so it does not need `script-variables:*` permissions; existing values are kept. Operators who relied on the installer to set it must set it in HappyView directly.
