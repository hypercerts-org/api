import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const apiRoot = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: apiRoot });

async function lint(source) {
  const [result] = await eslint.lintText(source, { filePath: 'tooling/maintainability-fixture.js' });
  return result.messages;
}

function ruleIds(messages) {
  return messages.map(({ ruleId }) => ruleId);
}

test('rejects named synchronous child_process APIs from either Node module spelling', async () => {
  for (const specifier of ['node:child_process', 'child_process']) {
    for (const imported of ['exec', 'execSync']) {
      const messages = await lint(`import { ${imported} as run } from '${specifier}'; run('tool');`);
      assert.deepEqual(ruleIds(messages), ['no-restricted-imports'], `${specifier} must not provide ${imported}`);
    }
  }
});

test('rejects namespace imports from either child_process module spelling', async () => {
  for (const specifier of ['node:child_process', 'child_process']) {
    const messages = await lint(`import * as childProcess from '${specifier}'; childProcess.spawn('tool', []);`);
    assert.deepEqual(ruleIds(messages), ['no-restricted-imports'], `${specifier} namespace imports are intentionally restricted`);
  }
});

test('rejects static shell:true keys on subprocess calls but allows unrelated shell options', async () => {
  const messages = await lint([
    "import { spawn, spawnSync } from 'node:child_process';",
    "spawn('tool', [], { shell: true });",
    "spawn('tool', [], { 'shell': true });",
    "spawn('tool', [], { ['shell']: true });",
    "spawnSync('tool', [], { shell: true });",
    "spawnSync('tool', [], { 'shell': true });",
    "spawnSync('tool', [], { ['shell']: true });",
    'const subprocess = { spawn: (...args) => args };',
    "subprocess.spawn('tool', [], { shell: true });",
    "subprocess.spawn('tool', [], { 'shell': true });",
    "subprocess.spawn('tool', [], { ['shell']: true });",
    '({ shell: true });',
  ].join('\n'));

  assert.deepEqual(ruleIds(messages), [
    'no-restricted-syntax', 'no-restricted-syntax', 'no-restricted-syntax',
    'no-restricted-syntax', 'no-restricted-syntax', 'no-restricted-syntax',
    'no-restricted-syntax', 'no-restricted-syntax', 'no-restricted-syntax',
  ]);

  const allowed = await lint([
    "import { spawn } from 'node:child_process';",
    "spawn('tool', [], { shell: false });",
    '({ shell: true });',
  ].join('\n'));
  assert.deepEqual(ruleIds(allowed), []);
});

test('rejects direct and static computed process.exit while allowing process.exitCode', async () => {
  assert.deepEqual(ruleIds(await lint('process.exit(1);')), ['no-restricted-properties']);
  assert.deepEqual(ruleIds(await lint("process['exit'](1);")), ['no-restricted-properties']);
  assert.deepEqual(ruleIds(await lint('process.exitCode = 1;')), []);
});
