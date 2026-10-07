# JavaScript tooling safeguards

The API package uses ESLint restrictions and strict TypeScript checking to keep
its JavaScript tooling predictable. These are static safeguards; accompanying
type annotations preserve behavior for valid installer, seed, and HTTP-test
inputs.

## ESLint restrictions

The package ESLint config applies these rules to JavaScript files under `api/`:

- Named `exec` and `execSync` imports from `node:child_process` and
  `child_process` are rejected, including locally renamed imports. Namespace
  imports from either module are intentionally rejected wholesale; use a named
  safe import such as `{ spawn }` or `{ spawnSync }`.
- `shell: true` is rejected when a bare `shell` key, quoted key, or
  string-literal computed key such as `['shell']` appears in an object literal
  passed directly as an argument to a recognized `spawn` or `spawnSync` call,
  including member calls such as `childProcess.spawn(...)`. Unrelated objects
  may use a `shell` property; default shell behavior and explicit
  `shell: false` remain allowed.
- `process.exit(...)` is rejected. Set `process.exitCode` so pending cleanup
  and asynchronous work can finish.

These static rules do not perform data-flow analysis. Namespace imports are
rejected wholesale, but a default import of either child-process module can
bypass the named `exec`/`execSync` restriction; use named imports for allowed
APIs. CommonJS `require` and computed/dynamic module loading are also not
tracked. The subprocess selector does not follow a
named `spawn` import renamed to another identifier, copied function references,
template/expression shell keys, inline object spreads, computed method names,
or options stored in a variable or alias. Because it keys on call names, it can
also match an unrelated bare `spawn(...)` function or an unrelated object's
`.spawn(...)` method. The `process.exit` restriction covers direct access and
literal property access such as `process['exit']`; it makes no general guarantee
for computed expressions and does not track aliases. Keep those limitations in
mind during review.

## Type checking

`api/tsconfig.json` enables `checkJs`, `strict`, and `noUncheckedIndexedAccess`
for `tooling/installer.js`, `tooling/run-http-tests.js`, and `tooling/seed.js`.
`lint-lua.js` is outside this iteration's selected typecheck scope. Installer
progress iteration uses `states.entries()` so the state is
known to exist without an unchecked array-index assertion. Because `seed.js`
imports the fixture builders, their row shapes and callback signatures also
have JSDoc types; these annotations do not change fixture data or runtime
behavior.

## Validation

Run from the repository root:

```sh
pnpm --dir api run lint:js
pnpm --dir api run typecheck
pnpm --dir api run test:unit
```

Focused checks for these safeguards and their owners are:

```sh
cd api
pnpm exec eslint --max-warnings=0 --report-unused-disable-directives \
  eslint.config.js tooling/installer.js tooling/run-http-tests.js tooling/seed.js \
  tests/unit/tooling/eslint-maintainability.test.js
node --test tests/unit/tooling/eslint-maintainability.test.js \
  tests/unit/tooling/installer.test.js \
  tests/unit/tooling/installer-core.test.js \
  tests/unit/tooling/seed.test.js
pnpm run typecheck
```

The HTTP runtime suite is not required for these static checks and launches
Docker-managed services; use the separate procedure in `CONTRIBUTING.md` only
when that runtime validation is explicitly intended.

The aggregate typecheck follows `seed.js` imports into the fixture modules.
Those imported fixture modules are included in the checked boundary so row
shapes and the date-fixture decorator callback remain explicit; the ordinary
fixture values and generated SQL are unchanged.
