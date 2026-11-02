import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('../../', import.meta.url));

test('workscope-tag offline Lua suite executes all nine cases', (t) => {
  const result = spawnSync('lua5.4', ['tests/unit/workscopeTags.test.lua'], {
    cwd: apiRoot,
    encoding: 'utf8',
  });

  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);

  const cases = result.stdout.match(/^ok - .+$/gm) ?? [];
  assert.ok(cases.length >= 9, `expected all nine workscope-tag Lua cases to execute, got ${cases.length}`);
  for (const line of cases) t.diagnostic(line);
  t.diagnostic(`Executed ${cases.length} workscope-tag Lua cases.`);
});
