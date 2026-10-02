import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const runnerPath = path.join(packageRoot, 'tooling/contracts.js');

test('readiness timeout reports diagnostics and removes only its Compose project', async (t) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(503);
    response.end('starting');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const root = await mkdtemp(path.join(os.tmpdir(), 'happyview-contract-timeout-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  const dockerLog = path.join(root, 'docker.log');
  const fakePsql = path.join(root, 'psql');
  await writeFile(fakePsql, '#!/bin/sh\\nexit 0\\n', { mode: 0o700 });
  await chmod(fakePsql, 0o700);
  const fakeDocker = path.join(bin, 'docker');
  await writeFile(fakeDocker, [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$CONTRACTS_DOCKER_LOG"',
    'case " $* " in',
    '  *" port happyview 3000 "*) printf "127.0.0.1:%s\\n" "$CONTRACTS_HTTP_PORT" ;;',
    '  *" port postgres 5432 "*) printf "127.0.0.1:54321\\n" ;;',
    'esac',
    '',
  ].join('\n'), { mode: 0o700 });
  await chmod(fakeDocker, 0o700);

  const child = spawnSync(process.execPath, [runnerPath], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 5000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      CONTRACTS_DOCKER_LOG: dockerLog,
      CONTRACTS_HTTP_PORT: String(server.address().port),
      PSQL_PATH: fakePsql,
      HAPPYVIEW_CONTRACTS_READY_TIMEOUT_MS: '50',
      HAPPYVIEW_CONTRACTS_READY_POLL_MS: '5',
    },
  });

  const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`;
  assert.equal(child.status, 1, output);
  assert.match(output, /timed out waiting for HappyView/i);
  const calls = (await readFile(dockerLog, 'utf8')).trim().split('\n');
  assert.ok(requests > 0, `runner must probe the published health endpoint: ${output}\nDocker calls: ${calls.join('\n')}`);
  const startup = calls.find((call) => /\bup\b/.test(call));
  const project = startup?.match(/(?:--project-name|-p)\s+(\S+)/)?.[1];
  assert.ok(project, `startup must name its unique project: ${calls.join('\n')}`);
  assert.ok(calls.some((call) => /\blogs\b/.test(call) && call.includes(project)), 'timeout must collect this project’s logs');
  assert.ok(calls.some((call) => /\bdown\b/.test(call) && call.includes(project)), 'timeout must clean up this project');
});

async function createFakeAdminRuntime(t, { stageTimeoutMs, adminRequestTimeoutMs, onAdminRequest }) {
  let resolveAdminRequest;
  const adminRequest = new Promise((resolve) => { resolveAdminRequest = resolve; });
  let adminRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200);
      response.end('ok');
      return;
    }
    adminRequests++;
    resolveAdminRequest();
    onAdminRequest?.(request, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const root = await mkdtemp(path.join(os.tmpdir(), 'happyview-contract-subprocess-'));
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  const dockerLog = path.join(root, 'docker.log');
  const fakePsql = path.join(root, 'psql');
  await writeFile(fakePsql, ['#!/bin/sh', 'exit 0', ''].join('\n'), { mode: 0o700 });
  await chmod(fakePsql, 0o700);
  const fakeDocker = path.join(bin, 'docker');
  await writeFile(fakeDocker, [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$CONTRACTS_DOCKER_LOG"',
    'case " $* " in',
    '  *" port happyview 3000 "*) printf "127.0.0.1:%s\\n" "$CONTRACTS_HTTP_PORT" ;;',
    '  *" port postgres 5432 "*) printf "127.0.0.1:54321\\n" ;;',
    'esac',
    '',
  ].join('\n'), { mode: 0o700 });
  await chmod(fakeDocker, 0o700);

  const child = spawn(process.execPath, [runnerPath], {
    cwd: packageRoot,
    detached: true,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      CONTRACTS_DOCKER_LOG: dockerLog,
      CONTRACTS_HTTP_PORT: String(server.address().port),
      PSQL_PATH: fakePsql,
      HAPPYVIEW_CONTRACTS_READY_TIMEOUT_MS: '5000',
      HAPPYVIEW_CONTRACTS_READY_POLL_MS: '10',
      HAPPYVIEW_CONTRACTS_STAGE_TIMEOUT_MS: String(stageTimeoutMs),
      ...(adminRequestTimeoutMs === undefined ? {} : { HAPPYVIEW_CONTRACTS_ADMIN_REQUEST_TIMEOUT_MS: String(adminRequestTimeoutMs) }),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    try { child.kill('SIGTERM'); } catch { /* the runner already exited */ }
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* the subprocess group already exited */ }
    await rm(root, { recursive: true, force: true });
  });
  return {
    child,
    adminRequest,
    get adminRequests() { return adminRequests; },
    dockerLog,
    exited,
    output: () => output,
  };
}

async function settleWithin(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function assertScopedCleanup(dockerLog) {
  const calls = (await readFile(dockerLog, 'utf8')).trim().split('\n');
  const startup = calls.find((call) => /\bup\b/.test(call));
  const project = startup?.match(/(?:--project-name|-p)\s+(\S+)/)?.[1];
  assert.ok(project, `startup must name its unique project: ${calls.join('\n')}`);
  assert.ok(calls.some((call) => /\blogs\b/.test(call) && call.includes(project)), 'failure cleanup must collect this project’s diagnostics');
  assert.ok(calls.some((call) => /\bdown\b/.test(call) && call.includes(project)), 'failure cleanup must remove this project');
  const envFile = startup.match(/--env-file\s+(\S+)/)?.[1];
  assert.ok(envFile, `Compose startup must identify the generated env file: ${calls.join('\n')}`);
  await assert.rejects(readFile(envFile), { code: 'ENOENT' });
}

test('a hanging installer child reaches its deadline and cleans its Compose project', async (t) => {
  const runtime = await createFakeAdminRuntime(t, { stageTimeoutMs: 1_000 });
  const result = await settleWithin(runtime.exited, 8_000, 'runtime runner did not enforce the installer deadline');
  const output = runtime.output();
  assert.deepEqual(result, { code: 1, signal: null }, output);
  assert.match(output, /tooling\/installer\.js timed out after 1000ms/i);
  assert.ok(runtime.adminRequests > 0, 'the installer must be blocked in the non-responding admin HTTP request');
  await assertScopedCleanup(runtime.dockerLog);
});

test('read-back admin requests have a bounded deadline and clean the Compose project', async (t) => {
  let assetsWritten = false;
  let readbackRequests = 0;
  const runtime = await createFakeAdminRuntime(t, {
    stageTimeoutMs: 10_000,
    adminRequestTimeoutMs: 250,
    onAdminRequest: (request, response) => {
      if (request.method === 'GET') {
        if (assetsWritten) {
          readbackRequests++;
          return;
        }
        response.writeHead(404);
        response.end();
        return;
      }
      request.resume();
      assetsWritten = true;
      response.writeHead(204);
      response.end();
    },
  });
  const result = await settleWithin(runtime.exited, 8_000, 'read-back request deadline did not clean up the runtime');
  const output = runtime.output();
  assert.deepEqual(result, { code: 1, signal: null }, output);
  assert.match(output, /HappyView asset read-back request timed out after 250ms/i);
  assert.ok(assetsWritten, 'the real installer child must finish writing before read-back begins');
  assert.ok(readbackRequests > 0, 'the server must stall a real read-back request');
  await assertScopedCleanup(runtime.dockerLog);
});

test('SIGTERM during a hanging installer request cleans its Compose project and env file', async (t) => {
  const runtime = await createFakeAdminRuntime(t, { stageTimeoutMs: 30_000 });
  await settleWithin(runtime.adminRequest, 8_000, 'installer did not reach the stalled admin request');
  assert.equal(runtime.adminRequests, 1, 'the installer child must be blocked in an actual admin HTTP request');
  runtime.child.kill('SIGTERM');
  const result = await settleWithin(runtime.exited, 8_000, 'runtime runner did not finish signal cleanup');
  const output = runtime.output();
  assert.deepEqual(result, { code: 143, signal: null }, output);
  assert.match(output, /received SIGTERM/i);
  await assertScopedCleanup(runtime.dockerLog);
});
