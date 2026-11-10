import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
// Resolve the binary through the package so the test does not depend on
// node_modules/.bin or a shell.
const biome = createRequire(path.join(repoRoot, "package.json")).resolve(
  "@biomejs/biome/bin/biome",
);

/**
 * Lints `source` as a JavaScript file under happyview-modules/tooling, where the
 * restrictions apply. Biome does not report diagnostics for stdin input, so the
 * source is written to a temporary file in that directory.
 */
function lint(source) {
  const dir = mkdtempSync(path.join(repoRoot, "happyview-modules/tooling/.lint-fixture-"));
  try {
    const file = path.join(dir, "fixture.js");
    writeFileSync(file, source);
    const result = spawnSync(
      process.execPath,
      [biome, "lint", "--reporter=json", "--max-diagnostics=none", file],
      { cwd: repoRoot, encoding: "utf8" },
    );
    return JSON.parse(result.stdout).diagnostics;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Only the restrictions under test; recommended style rules also fire on these snippets.
const restrictions = new Set([
  "lint/style/noRestrictedImports",
  "lint/nursery/noProcessExit",
  "plugin",
]);

function categories(diagnostics) {
  return diagnostics
    .map(({ category }) => category)
    .filter((category) => restrictions.has(category));
}

test("rejects named synchronous child_process APIs from either Node module spelling", () => {
  for (const specifier of ["node:child_process", "child_process"]) {
    for (const imported of ["exec", "execSync"]) {
      const diagnostics = lint(`import { ${imported} as run } from '${specifier}'; run('tool');`);
      assert.deepEqual(
        categories(diagnostics),
        ["lint/style/noRestrictedImports"],
        `${specifier} must not provide ${imported}`,
      );
    }
  }
});

test("rejects namespace imports from either child_process module spelling", () => {
  for (const specifier of ["node:child_process", "child_process"]) {
    const diagnostics = lint(
      `import * as childProcess from '${specifier}'; childProcess.spawn('tool', []);`,
    );
    assert.deepEqual(
      categories(diagnostics),
      ["lint/style/noRestrictedImports"],
      `${specifier} namespace imports are intentionally restricted`,
    );
  }
});

test("rejects static shell:true keys on subprocess calls but allows unrelated shell options", () => {
  const diagnostics = lint(
    [
      "import { spawn, spawnSync } from 'node:child_process';",
      "spawn('tool', [], { shell: true });",
      "spawn('tool', [], { 'shell': true });",
      "spawn('tool', [], { ['shell']: true });",
      "spawnSync('tool', [], { shell: true });",
      "spawnSync('tool', [], { 'shell': true });",
      "spawnSync('tool', [], { ['shell']: true });",
      "const subprocess = { spawn: (...args) => args };",
      "subprocess.spawn('tool', [], { shell: true });",
      "subprocess.spawn('tool', [], { 'shell': true });",
      "subprocess.spawn('tool', [], { ['shell']: true });",
      "({ shell: true });",
    ].join("\n"),
  );
  assert.deepEqual(categories(diagnostics), Array(9).fill("plugin"));

  const allowed = lint(
    [
      "import { spawn } from 'node:child_process';",
      "spawn('tool', [], { shell: false });",
      "({ shell: true });",
    ].join("\n"),
  );
  assert.deepEqual(categories(allowed), []);
});

test("rejects direct and static computed process.exit while allowing process.exitCode", () => {
  assert.deepEqual(categories(lint("process.exit(1);")), ["lint/nursery/noProcessExit"]);
  assert.deepEqual(categories(lint("process['exit'](1);")), ["lint/nursery/noProcessExit"]);
  assert.deepEqual(categories(lint("process.exitCode = 1;")), []);
});
