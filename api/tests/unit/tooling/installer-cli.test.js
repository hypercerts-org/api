import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveInstallConfig } from '../../../tooling/installer.js';

test('installer prompts for missing URL and token, hiding the token input', async () => {
  const prompts = [];
  const answers = ['https://happyview.example', 'hv_admin-token'];
  const config = await resolveInstallConfig({
    env: {},
    isTTY: true,
    ask: async (label, { hidden }) => {
      prompts.push({ label, hidden });
      return answers.shift();
    },
  });

  assert.deepEqual(config, {
    baseUrl: 'https://happyview.example',
    token: 'hv_admin-token',
  });
  assert.deepEqual(prompts, [
    { label: 'HappyView URL', hidden: false },
    { label: 'HappyView admin token', hidden: true },
  ]);
});

test('CLI requires a nonblank admin token and does not fall back to a session cookie', () => {
  const script = fileURLToPath(new URL('../../../tooling/installer.js', import.meta.url));
  for (const token of [undefined, '', ' \t']) {
    const env = {
      PATH: process.env.PATH ?? '',
      HAPPYVIEW_BASE_URL: 'http://127.0.0.1:8080',
      HAPPYVIEW_SESSION_COOKIE: 'session=legacy-secret',
    };
    if (token !== undefined) env.HAPPYVIEW_ADMIN_TOKEN = token;
    const child = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /HAPPYVIEW_ADMIN_TOKEN.*README/);
    assert.doesNotMatch(child.stderr, /legacy-secret|manifest\.json/);
  }
});

test('CLI help documents the explicit override and safe default without requiring credentials', () => {
  const script = fileURLToPath(new URL('../../../tooling/installer.js', import.meta.url));
  const child = spawnSync(process.execPath, [script, '--help'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });

  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /Usage: pnpm install:api .*--override/);
  assert.match(child.stdout, /Without it, conflicts are refused before any asset writes/);
  assert.equal(child.stderr, '');
});

test('CLI accepts --override and --debug before target validation', () => {
  const script = fileURLToPath(new URL('../../../tooling/installer.js', import.meta.url));
  const child = spawnSync(process.execPath, [script, '--override', '--debug'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HAPPYVIEW_BASE_URL: 'not a URL',
      HAPPYVIEW_ADMIN_TOKEN: 'hv_cli-test-token',
    },
  });

  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, 'HappyView admin URL must be a valid HTTP(S) URL\n');
});

test('CLI reports an actionable error for a malformed HappyView admin URL', () => {
  const script = fileURLToPath(new URL('../../../tooling/installer.js', import.meta.url));
  const child = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HAPPYVIEW_BASE_URL: 'not a URL',
      HAPPYVIEW_ADMIN_TOKEN: 'hv_cli-test-token',
    },
  });

  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, 'HappyView admin URL must be a valid HTTP(S) URL\n');
});

test('importing the installer does not run the CLI or require configuration', () => {
  const script = fileURLToPath(new URL('../../../tooling/installer.js', import.meta.url));
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[1])', pathToFileURL(script).href], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
});

test('CLI writes per-asset progress to stderr and keeps its JSON result on stdout', async () => {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/admin/script-variables') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('[]');
    } else if (request.method === 'GET') {
      response.writeHead(404).end();
    } else {
      response.writeHead(204).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    const script = fileURLToPath(new URL('../../../tooling/installer.js', import.meta.url));
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        HAPPYVIEW_BASE_URL: `http://127.0.0.1:${address.port}`,
        HAPPYVIEW_ADMIN_TOKEN: 'hv_cli-test-token',
        HYPERCERTS_HANDLE_RESOLVER_URL: 'https://resolver.example',
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const { code, signal } = await new Promise((resolve) => {
      child.once('close', (exitCode, childSignal) => resolve({ code: exitCode, signal: childSignal }));
    });

    assert.equal(code, 0, `signal: ${signal}; stderr: ${stderr}`);
    const result = JSON.parse(stdout);
    const progress = stderr.trimEnd().split('\n');
    const checks = progress.filter((line) => line.startsWith('[check '));
    const installs = progress.filter((line) => line.startsWith('[install '));
    const total = result.changed.length + result.unchanged.length;

    assert.equal(checks.length, total);
    assert.equal(installs.length, result.changed.length);
    assert.match(checks[0], new RegExp(`^\\[check 1/${total}\\] \\S+$`));
    assert.match(installs[0], new RegExp(`^\\[install 1/${result.changed.length}\\] \\S+$`));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('CLI main-module detection works when the checkout path contains #', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'happyview#installer-cli-'));
  try {
    const tooling = path.join(root, 'tooling');
    const shared = path.join(root, 'shared');
    await mkdir(tooling);
    await mkdir(shared);
    const script = path.join(tooling, 'installer.js');
    await copyFile(fileURLToPath(new URL('../../../tooling/installer.js', import.meta.url)), script);
    await writeFile(path.join(tooling, 'lexicon-source.js'), 'export async function readLexiconSource() { return {}; }');
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ modules: ['shared/manifest.json'] }));
    await writeFile(path.join(shared, 'manifest.json'), JSON.stringify({
      assets: [{ id: 'org.example.missing', kind: 'script', config: { script_type: 'query' }, path: 'missing.lua' }],
    }));

    const child = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HAPPYVIEW_BASE_URL: 'http://127.0.0.1:8000',
        HAPPYVIEW_ADMIN_TOKEN: 'hv_cli-test-token',
      },
    });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /source missing\.lua is missing/);
    assert.doesNotMatch(child.stderr, /HAPPYVIEW_(BASE_URL|ADMIN_TOKEN) is required/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
