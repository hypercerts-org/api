import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('source refresh gives an actionable usage error when no checkout root is supplied', () => {
  const result = spawnSync(process.execPath, ['scripts/refresh-sources.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: node scripts\/refresh-sources\.mjs <happyview-worktrees-root>/);
});
