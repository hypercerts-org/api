import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('source refresh help describes the manifest-driven workspace command', () => {
  const result = spawnSync(process.execPath, ['scripts/refresh-sources.mjs', '--help'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: pnpm docs:sync/);
  assert.match(result.stdout, /api\/manifest\.json/);
  assert.equal(result.stderr, '');
});
