import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'node:net';
import { compareAsset, createAdminClient, loadAssets } from './installer.js';
import { runProcess } from './child-process.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const composeFile = path.join(packageRoot, 'docker-compose.contracts.yml');

async function availableLoopbackPort(excluded = new Set()) {
  for (;;) {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (port > 0 && !excluded.has(port)) return port;
  }
}

const ADMIN_PERMISSIONS = [
  'lexicons:create', 'lexicons:read',
  'script-variables:create', 'script-variables:read',
  'scripts:read', 'scripts:manage',
];

function trustedPsqlPath(value) {
  if (!value || !path.isAbsolute(value)) throw new Error('Set PSQL_PATH to the absolute path of a trusted psql executable');
  try {
    if (!statSync(value).isFile()) throw new Error('not a regular file');
    accessSync(value, constants.X_OK);
  } catch (error) {
    throw new Error(`PSQL_PATH must point to an existing executable file (${value}): ${error.message}`, { cause: error });
  }
  return value;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function runPsql(psqlPath, env, sql, { signal, timeoutMs }) {
  const result = await runProcess(psqlPath, [
    '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--host', '127.0.0.1',
    '--port', env.PGPORT, '--dbname', env.PGDATABASE, '--username', env.PGUSER,
  ], {
    input: sql,
    env: { ...env, PGPASSWORD: env.PGPASSWORD, PGSSLMODE: 'disable' },
    stdio: ['pipe', 'ignore', 'pipe'],
    signal,
    timeoutMs,
    label: 'Disposable database auth bootstrap',
  });
  if (result.code !== 0 || result.stdinError) {
    const details = [
      result.stderr.trim(),
      result.stdinError && `stdin write failed: ${result.stdinError.message}`,
    ].filter(Boolean).join('; ');
    const status = result.code !== 0 ? ` with exit status ${result.code}` : '';
    const message = [`Disposable database auth bootstrap failed${status}`, details].filter(Boolean).join(': ');
    throw new Error(message, {
      ...(result.stdinError ? { cause: result.stdinError } : {}),
    });
  }
}

async function runNodeTool(script, env, { signal, timeoutMs }) {
  const result = await runProcess(process.execPath, [path.join(packageRoot, script)], {
    cwd: packageRoot, env, stdio: 'inherit', signal, timeoutMs, label: script,
  });
  if (result.code !== 0) throw new Error(`${script} failed with exit status ${result.code}`);
}

async function publishedPort(project, envFile, service, containerPort, signal) {
  const { stdout } = await runDocker(project, envFile, ['port', service, String(containerPort)], { signal });
  const output = stdout.trim();
  const match = /^127\.0\.0\.1:(\d+)$/.exec(output);
  const port = Number(match?.[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Expected Docker Compose to publish ${service} on a loopback port; received ${output || '(empty)'}`);
  }
  return String(port);
}

async function bootstrapAdmin(psqlPath, env, { signal, timeoutMs }) {
  const token = `hv_${randomBytes(16).toString('hex')}`;
  const userId = randomUUID();
  const apiKeyId = randomUUID();
  const did = `did:web:contract-${randomBytes(4).toString('hex')}.invalid`;
  const now = new Date().toISOString();
  const keyHash = createHash('sha256').update(token).digest('hex');
  const sql = [
    'BEGIN;',
    `INSERT INTO happyview_users (id, did, is_super, created_at) VALUES (${sqlLiteral(userId)}, ${sqlLiteral(did)}, 1, ${sqlLiteral(now)});`,
    ...ADMIN_PERMISSIONS.map((permission) => `INSERT INTO happyview_user_permissions (user_id, permission, granted_at) VALUES (${sqlLiteral(userId)}, ${sqlLiteral(permission)}, ${sqlLiteral(now)});`),
    `INSERT INTO happyview_api_keys (id, user_id, name, key_hash, key_prefix, permissions, created_at) VALUES (${sqlLiteral(apiKeyId)}, ${sqlLiteral(userId)}, 'hypercerts contract runner', ${sqlLiteral(keyHash)}, ${sqlLiteral(token.slice(0, 11))}, ${sqlLiteral(JSON.stringify(ADMIN_PERMISSIONS))}, ${sqlLiteral(now)});`,
    'COMMIT;',
  ].join('\n');
  await runPsql(psqlPath, env, sql, { signal, timeoutMs });
  return token;
}

async function verifyInstalledAssets(baseUrl, token, { signal, stageTimeoutMs, requestTimeoutMs }) {
  const stageDeadline = AbortSignal.timeout(stageTimeoutMs);
  const stageSignal = AbortSignal.any([signal, stageDeadline]);
  let requestTimedOut = false;
  const admin = createAdminClient({
    baseUrl,
    token,
    fetchImpl: async (input, init = {}) => {
      const requestDeadline = AbortSignal.timeout(requestTimeoutMs);
      try {
        return await fetch(input, { ...init, signal: AbortSignal.any([stageSignal, requestDeadline]) });
      } catch (error) {
        if (requestDeadline.aborted && !stageSignal.aborted) requestTimedOut = true;
        throw error;
      }
    },
  });
  try {
    const { assets } = await loadAssets(path.join(packageRoot, 'manifest.json'));
    for (const asset of assets) {
      stageSignal.throwIfAborted();
      requestTimedOut = false;
      if (compareAsset(asset, await admin.read(asset)) !== 'unchanged') {
        throw new Error(`HappyView did not retain the declared ${asset.kind} asset ${asset.id} after installation`);
      }
    }
    stageSignal.throwIfAborted();
    return assets;
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
    if (stageDeadline.aborted) throw new Error(`Manifest asset read-back timed out after ${stageTimeoutMs}ms`, { cause: error });
    if (requestTimedOut) throw new Error(`HappyView asset read-back request timed out after ${requestTimeoutMs}ms`, { cause: error });
    throw error;
  }
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function logError(message) {
  process.stderr.write(`${message}\n`);
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

async function runDocker(project, envFile, args, { signal, timeoutMs = 300_000, allowFailure = false } = {}) {
  const env = { ...process.env };
  for (const key of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'POSTGRES_HOST_PORT', 'HAPPYVIEW_HOST_PORT', 'SESSION_SECRET', 'TOKEN_ENCRYPTION_KEY']) delete env[key];
  const result = await runProcess('docker', [
    'compose', '--project-name', project, '--env-file', envFile, '-f', composeFile, ...args,
  ], { env, stdio: ['ignore', 'pipe', 'pipe'], timeoutMs, signal, label: `Docker Compose ${args[0]}` });
  if (result.code !== 0 && !allowFailure) {
    const message = `Docker Compose ${args[0]} for project ${project} failed`;
    throw new Error([message, result.stderr.trim()].filter(Boolean).join(': '));
  }
  return { code: result.code, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function composeProjectRecovery(project) {
  const filter = `label=com.docker.compose.project=${project}`;
  return [
    `Project-scoped manual cleanup for ${project} (exact Docker label ${filter}):`,
    `  docker ps -aq --filter '${filter}' | while IFS= read -r id; do [ -z "$id" ] || docker rm -f "$id"; done`,
    `  docker network ls -q --filter '${filter}' | while IFS= read -r id; do [ -z "$id" ] || docker network rm "$id"; done`,
    `  docker volume ls -q --filter '${filter}' | while IFS= read -r id; do [ -z "$id" ] || docker volume rm "$id"; done`,
  ].join('\n');
}

async function removeComposeProject(project, envFile) {
  let firstFailure;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await runDocker(project, envFile, ['down', '--volumes', '--remove-orphans'], { timeoutMs: 30_000 });
      log(`Removed disposable Compose project ${project}${attempt === 2 ? ' after one retry' : ''}`);
      return;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (attempt === 1) {
        firstFailure = failure;
        logError(`Docker Compose teardown failed for project ${project}; retrying once: ${failure.message}`);
        continue;
      }
      throw new Error(`${failure.message}; first teardown attempt also failed: ${firstFailure.message}\n${composeProjectRecovery(project)}`, { cause: error });
    }
  }
}

async function waitForHealth(baseUrl, timeoutMs, pollMs, signal) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1000, Math.min(2000, pollMs * 4)))]);
      const response = await fetch(`${baseUrl}/health`, { signal: requestSignal });
      if (response.ok) return;
      lastStatus = `HTTP ${response.status}`;
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await delay(Math.min(pollMs, Math.max(0, deadline - Date.now())), undefined, { signal });
  }
  throw new Error(`Timed out waiting for HappyView GET /health after ${timeoutMs}ms (last result: ${lastStatus})`);
}

// Matches default string sorting by UTF-16 code units, without locale-sensitive collation.
function compareCodeUnits(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function runRuntimeStages(project, signal, recordResources) {
  const psqlPath = trustedPsqlPath(process.env.PSQL_PATH);
  const readyTimeoutMs = positiveInteger(process.env.HAPPYVIEW_CONTRACTS_READY_TIMEOUT_MS, 180_000, 'HAPPYVIEW_CONTRACTS_READY_TIMEOUT_MS');
  const readyPollMs = positiveInteger(process.env.HAPPYVIEW_CONTRACTS_READY_POLL_MS, 1_000, 'HAPPYVIEW_CONTRACTS_READY_POLL_MS');
  const stageTimeoutMs = positiveInteger(process.env.HAPPYVIEW_CONTRACTS_STAGE_TIMEOUT_MS, 120_000, 'HAPPYVIEW_CONTRACTS_STAGE_TIMEOUT_MS');
  const adminRequestTimeoutMs = positiveInteger(process.env.HAPPYVIEW_CONTRACTS_ADMIN_REQUEST_TIMEOUT_MS, 15_000, 'HAPPYVIEW_CONTRACTS_ADMIN_REQUEST_TIMEOUT_MS');
  const happyviewHostPort = await availableLoopbackPort();
  const postgresHostPort = await availableLoopbackPort(new Set([happyviewHostPort]));
  signal.throwIfAborted();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'happyview-contract-'));
  const envFile = path.join(tempDir, 'compose.env');
  recordResources({ tempDir, envFile });
  const database = `happyview_contract_test_${randomBytes(5).toString('hex')}`;
  const databaseUser = `contract_${randomBytes(4).toString('hex')}`;
  const password = randomBytes(32).toString('hex');
  await writeFile(envFile, [
    `POSTGRES_USER=${databaseUser}`,
    `POSTGRES_PASSWORD=${password}`,
    `POSTGRES_DB=${database}`,
    `POSTGRES_HOST_PORT=${postgresHostPort}`,
    `HAPPYVIEW_HOST_PORT=${happyviewHostPort}`,
    `SESSION_SECRET=${randomBytes(48).toString('hex')}`,
    `TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`,
    '',
  ].join('\n'), { mode: 0o600 });

  signal.throwIfAborted();
  recordResources({ composeStarted: true });
  await runDocker(project, envFile, ['up', '--detach'], { signal });
  const happyviewPort = await publishedPort(project, envFile, 'happyview', 3000, signal);
  const postgresPort = await publishedPort(project, envFile, 'postgres', 5432, signal);
  const baseUrl = `http://127.0.0.1:${happyviewPort}`;
  await waitForHealth(baseUrl, readyTimeoutMs, readyPollMs, signal);
  log(`HappyView is ready at ${baseUrl}/health (${project})`);

  const databaseEnv = {
    ...process.env,
    PSQL_PATH: psqlPath,
    HAPPYVIEW_DISPOSABLE_TEST_TARGET: 'YES',
    PGHOST: '127.0.0.1',
    PGPORT: postgresPort,
    PGDATABASE: database,
    PGUSER: databaseUser,
    PGPASSWORD: password,
    PGSSLMODE: 'disable',
  };
  delete databaseEnv.PGHOSTADDR;
  delete databaseEnv.PGSERVICE;
  delete databaseEnv.PGSERVICEFILE;

  log('Bootstrapping a scoped admin API key in the new disposable database');
  const adminToken = await bootstrapAdmin(psqlPath, databaseEnv, { signal, timeoutMs: stageTimeoutMs });
  const appEnv = {
    ...databaseEnv,
    HAPPYVIEW_BASE_URL: baseUrl,
    HAPPYVIEW_ADMIN_TOKEN: adminToken,
    HYPERCERTS_HANDLE_RESOLVER_URL: 'https://resolver.invalid',
  };

  log('Installing the current branch manifest through HappyView’s localhost admin API');
  await runNodeTool('tooling/installer.js', appEnv, { signal, timeoutMs: stageTimeoutMs });
  const assets = await verifyInstalledAssets(baseUrl, adminToken, {
    signal, stageTimeoutMs, requestTimeoutMs: adminRequestTimeoutMs,
  });
  log(`Verified ${assets.length} installed manifest assets against HappyView admin reads`);

  log(`Seeding deterministic fixtures into ${database}`);
  await runNodeTool('tooling/seed.js', databaseEnv, { signal, timeoutMs: stageTimeoutMs });

  const handlers = assets
    .filter((asset) => asset.kind === 'script' && asset.id.startsWith('xrpc.query:'))
    .map((asset) => asset.id.slice('xrpc.query:'.length))
    .sort(compareCodeUnits);
  await runNodeTool('tooling/contract-suites.js', {
    ...appEnv,
    HAPPYVIEW_CONTRACT_HANDLERS: JSON.stringify(handlers),
  }, { signal, timeoutMs: stageTimeoutMs });
  signal.throwIfAborted();
}

async function main() {
  const controller = new AbortController();
  let receivedSignal;
  const requestStop = (name) => {
    receivedSignal ??= name;
    controller.abort(new Error(`Received ${receivedSignal}; stopping runtime contract stages`));
  };
  const onSigint = () => requestStop('SIGINT');
  const onSigterm = () => requestStop('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  const project = `happyview-contract-${process.pid}-${randomBytes(5).toString('hex')}`;
  let resources = { tempDir: null, envFile: null, composeStarted: false };
  let primaryError;
  const cleanupErrors = [];
  try {
    await runRuntimeStages(project, controller.signal, (update) => {
      resources = { ...resources, ...update };
    });
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
  } finally {
    // composeStarted is recorded only after the generated env file has been written.
    if (primaryError && resources.composeStarted) {
      try {
        const diagnostics = await runDocker(project, resources.envFile, ['logs', '--no-color', '--timestamps'], {
          timeoutMs: 15_000, allowFailure: true,
        });
        logError(`\nHappyView Compose diagnostics (${project}):\n${diagnostics.stdout}\n${diagnostics.stderr}`);
      } catch (error) {
        cleanupErrors.push(new Error(`Could not collect Compose diagnostics: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    if (resources.composeStarted) {
      try {
        await removeComposeProject(project, resources.envFile);
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (resources.tempDir) {
      try {
        await rm(resources.tempDir, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(new Error(`Could not remove generated Compose env directory: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }

  if (receivedSignal) process.exitCode = receivedSignal === 'SIGINT' ? 130 : 143;
  if (primaryError) {
    if (cleanupErrors.length > 0) primaryError.message += `; cleanup also failed: ${cleanupErrors.map((error) => error.message).join('; ')}`;
    throw primaryError;
  }
  if (cleanupErrors.length > 0) throw new Error(`Contract cleanup failed: ${cleanupErrors.map((error) => error.message).join('; ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    if (process.exitCode === undefined) process.exitCode = 1;
  }
}
