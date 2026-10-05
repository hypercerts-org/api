# Agent instructions

- Use the repository-pinned pnpm version and preserve the lockfile.
- Treat `api/manifest.json` as authoritative for the API modules included in this checkout.
- Read [CONTRIBUTING.md](CONTRIBUTING.md) for local validation and HTTP runtime test requirements before changing test or installer behavior.
- `pnpm install:api` sends admin requests to a HappyView instance and uploads assets. Do not run it unless the user explicitly approves the target and token in the current conversation.
- HTTP runtime tests use a task-owned local Compose project and disposable database. Do not target or tear down unrelated services; note that the Compose bridge network permits egress and the configured proxy is not network-level isolation.
