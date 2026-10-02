import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const suiteRunnerPath = fileURLToPath(new URL('./contract-suites.js', import.meta.url));

function suiteSource(traceLabel) {
  return [
    "import test from 'node:test';",
    "import { appendFileSync } from 'node:fs';",
    `test('${traceLabel} suite ran', () => appendFileSync(process.env.RUNTIME_TRACE, '${traceLabel}\\n'));`,
    '',
  ].join('\n');
}

test('runner executes normal HTTP suites before bad-date seeding and only seeds when that suite exists', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'happyview-contract-suite-order-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tooling = path.join(root, 'tooling');
  const suites = path.join(root, 'tests/contracts');
  await Promise.all([mkdir(tooling, { recursive: true }), mkdir(suites, { recursive: true })]);
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}\n');

  const runnerCopy = path.join(tooling, 'contract-suites.js');
  let sourceRunnerAvailable = true;
  try {
    await copyFile(suiteRunnerPath, runnerCopy);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    sourceRunnerAvailable = false;
  }
  const runner = sourceRunnerAvailable ? runnerCopy : suiteRunnerPath;

  await writeFile(path.join(tooling, 'seed.js'), [
    "import { appendFileSync } from 'node:fs';",
    "if (process.argv[2] !== '--bad-dates') throw new Error('expected the isolated bad-date seed mode');",
    "appendFileSync(process.env.RUNTIME_TRACE, 'bad-date-seed\\n');",
    '',
  ].join('\n'));

  const normalSuite = path.join(suites, 'location.contract.test.js');
  const badDateSuite = path.join(suites, 'location-bad-dates.contract.test.js');
  await writeFile(normalSuite, suiteSource('normal-suite'));
  await writeFile(badDateSuite, suiteSource('bad-date-suite'));
  await writeFile(path.join(suites, 'helpers.test.js'), "throw new Error('helper unit test must not run as an HTTP suite');\n");

  const trace = path.join(root, 'trace.log');
  const env = {
    PATH: process.env.PATH ?? '',
    RUNTIME_TRACE: trace,
    HAPPYVIEW_CONTRACT_HANDLERS: JSON.stringify(['app.certified.location.getLocation']),
  };

  const runRunner = () => spawnSync(process.execPath, [runner], { cwd: root, env, encoding: 'utf8', timeout: 10_000 });
  let child = runRunner();
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  assert.match(child.stdout, /Installed XRPC handlers \(1\)/);
  assert.match(child.stdout, /HTTP contract suites \(2\)/);
  assert.deepEqual((await readFile(trace, 'utf8')).trim().split('\n'), [
    'normal-suite', 'bad-date-seed', 'bad-date-suite',
  ]);

  await writeFile(trace, '');
  await rm(badDateSuite);
  child = runRunner();
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  assert.deepEqual((await readFile(trace, 'utf8')).trim().split('\n'), ['normal-suite']);
});
