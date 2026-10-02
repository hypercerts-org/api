import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const badDateSuiteName = 'location-bad-dates.contract.test.js';

function log(message) {
  process.stdout.write(`${message}\n`);
}

function installedHandlers() {
  let handlers;
  try {
    handlers = JSON.parse(process.env.HAPPYVIEW_CONTRACT_HANDLERS ?? '');
  } catch {
    throw new Error('HAPPYVIEW_CONTRACT_HANDLERS must be a JSON array supplied by tooling/contracts.js');
  }
  if (!Array.isArray(handlers) || handlers.some((handler) => typeof handler !== 'string')) {
    throw new Error('HAPPYVIEW_CONTRACT_HANDLERS must be a JSON array of XRPC handler NSIDs');
  }
  return [...handlers].sort();
}

async function endpointSuites() {
  const directory = path.join(packageRoot, 'tests/contracts');
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.contract.test.js'))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function runNode(args, name) {
  const result = spawnSync(process.execPath, args, {
    cwd: packageRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`Could not run ${name}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${name} failed with exit status ${result.status}`);
}

async function main() {
  const handlers = installedHandlers();
  const suites = await endpointSuites();
  const suiteNames = suites.map((suite) => path.basename(suite));
  log(`Installed XRPC handlers (${handlers.length}): ${handlers.join(', ') || '(none)'}`);
  log(`HTTP contract suites (${suites.length}): ${suiteNames.join(', ') || '(none)'}`);

  if (handlers.length > 0 && suites.length === 0) {
    throw new Error(`This branch installs ${handlers.length} XRPC handler(s) but has no *.contract.test.js HTTP suites; refusing to report endpoint coverage as successful`);
  }
  if (suites.length === 0) {
    log('Foundation-only runtime proof: migrations, admin auth, manifest installation, schema reads, and fixture seeding; no endpoint handlers or HTTP suites exist on this branch.');
    return;
  }

  const normalSuites = suites.filter((suite) => path.basename(suite) !== badDateSuiteName);
  const badDateSuites = suites.filter((suite) => path.basename(suite) === badDateSuiteName);
  if (normalSuites.length > 0) runNode(['--test', ...normalSuites], 'HTTP contract suites');

  if (badDateSuites.length > 0) {
    log('Seeding isolated bad-date fixtures after routine HTTP suites');
    runNode(['tooling/seed.js', '--bad-dates'], 'bad-date fixture seeding');
    runNode(['--test', ...badDateSuites], 'bad-date HTTP contract suites');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
