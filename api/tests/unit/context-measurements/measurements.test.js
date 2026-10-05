import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('measurement handlers preserve the public lookup, filtering, pagination, and hydration contract', () => {
  const result = spawnSync('lua5.4', ['tests/unit/context-measurements/measurements.lua'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /measurement behavior contracts passed/);
});
