import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from './child-process.js';

test('reports EPIPE and child exit status when a real child closes stdin before reading', async () => {
  const result = await runProcess(process.execPath, [
    '-e',
    'process.stdin.destroy(); setTimeout(() => process.exit(23), 100);',
  ], {
    input: Buffer.alloc(1024 * 1024),
    stdio: ['pipe', 'ignore', 'pipe'],
    timeoutMs: 5_000,
    label: 'early-closing child',
  });

  assert.equal(result.code, 23);
  assert.equal(result.signal, null);
  assert.equal(result.stdinError?.code, 'EPIPE');
});
