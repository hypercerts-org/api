import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../../../', import.meta.url));
const luaTest = fileURLToPath(new URL('../lua/recentFollows.test.lua', import.meta.url));

test('recent-follows offline Lua contract assertions pass', () => {
  const result = spawnSync('lua5.4', [luaTest], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stderr ?? ''}${result.stdout ?? ''}`);
});
