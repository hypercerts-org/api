# Agent instructions

- Use the repository-pinned pnpm version and preserve the lockfile.
- Treat `api/manifest.json` as authoritative for the API modules included in this checkout.
- For API endpoint, contract, or externally visible query-behavior changes, review the user-facing docs and update `.agents/skills/hypercerts-api/` in the same change. This includes the endpoint explorer in `docs/`; keep its committed Lexicon/OpenAPI snapshots and coverage metadata aligned with `api/manifest.json`, module manifests, and handler behavior, and update explorer tests when relevant. Keep the skill's bundled OpenAPI snapshot, endpoint map, and relevant consumer guidance aligned too; because the skill is distributed without this repository, keep its references self-contained and free of repo-relative contract links.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) for local validation and HTTP runtime test requirements before changing test or installer behavior.
- `pnpm install:api` sends admin requests to a HappyView instance and uploads assets. Do not run it unless the user explicitly approves the target and token in the current conversation.
- HTTP runtime tests use a task-owned local Compose project and disposable database. Do not target or tear down unrelated services; note that the Compose bridge network permits egress and the configured proxy is not network-level isolation.
