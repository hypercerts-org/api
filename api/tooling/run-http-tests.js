import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { appendFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSeedInput, psqlTargetArgs } from './seed.js';

const apiRoot = fileURLToPath(new URL('../', import.meta.url));
const composeFile = path.join(apiRoot, 'docker-compose.contracts.yml');
const httpTestRoot = path.join(apiRoot, 'tests', 'http');
const fixtureRoot = path.join(httpTestRoot, 'fixtures');
const services = new Set(['postgres', 'happyview']);
const proxyBlock = 'http://127.0.0.1:9';

function spawn(command, args, {
  cwd = apiRoot,
  env = process.env,
  input,
  maxBuffer = 16 * 1024 * 1024,
  timeoutMs = 30_000,
  label = `${command} ${args[0] ?? ''}`,
} = {}) {
  const result = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', maxBuffer, timeout: timeoutMs });
  if (result.error?.code === 'ETIMEDOUT') {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${label} timed out after ${timeoutMs}ms; the subprocess was terminated. Check task-owned Docker logs and local service health before retrying.`, { cause: result.error });
  }
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`, { cause: result.error });
  return result;
}

function run(command, args, options = {}) {
  const result = spawn(command, args, options);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit status ${result.status ?? 'unknown'}`);
  }
  return result.stdout;
}

function runQuiet(command, args, options = {}) {
  const result = spawn(command, args, options);
  if (result.status !== 0) {
    const failure = result.stderr || `exit status ${result.status ?? 'unknown'}`;
    throw new Error(`${command} ${args.join(' ')} failed: ${failure}`);
  }
  return result.stdout.trim();
}

function requirePsqlPath() {
  const executable = process.env.PSQL_PATH;
  if (!executable || !path.isAbsolute(executable)) {
    throw new Error('Set PSQL_PATH to the absolute path of a trusted psql executable (for example, PSQL_PATH="$(command -v psql)").');
  }
  try {
    if (!statSync(executable).isFile()) throw new Error('not a regular file');
    accessSync(executable, constants.X_OK);
  } catch (error) {
    throw new Error(`PSQL_PATH must point to an existing executable file (${executable}): ${error.message}`, { cause: error });
  }
  return executable;
}

function compareEntryNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

async function findFiles(directory, suffix) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  entries.sort(compareEntryNames);

  const fileGroups = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nestedFiles = await findFiles(entryPath, suffix);
      return nestedFiles;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) return [entryPath];
    return [];
  }));
  return fileGroups.flat();
}

async function loadFixtureRows(fixtureModules) {
  const rows = [];
  await fixtureModules.reduce((previous, file) => previous.then(async () => {
    const fixture = await import(pathToFileURL(file).href);
    if (!Array.isArray(fixture.seedRows) || fixture.seedRows.length === 0) {
      throw new Error(`${path.relative(apiRoot, file)} must export a nonempty seedRows array.`);
    }
    rows.push(...fixture.seedRows);
  }), Promise.resolve());
  if (rows.length === 0) throw new Error('No HTTP fixture rows found; add a *.fixture.js module under tests/http/fixtures.');
  return rows;
}

function dockerEnvironment() {
  const env = { ...process.env };
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  delete env.DOCKER_TLS_VERIFY;
  delete env.DOCKER_CERT_PATH;
  return env;
}

function assertLocalDocker(env) {
  const context = runQuiet('docker', ['context', 'show'], { env });
  const endpoint = runQuiet('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}', context], { env });
  if (!/^(unix|npipe):\/\//.test(endpoint)) {
    throw new Error(`Refusing non-local Docker context ${context} (${endpoint}); HTTP tests may use only a local Docker daemon.`);
  }
  return `${context} (${endpoint})`;
}

function imagesFromComposeConfig(config) {
  return [...services].map((service) => {
    const image = config.services?.[service]?.image;
    if (typeof image !== 'string' || !/@sha256:[a-f0-9]{64}$/i.test(image)) {
      throw new Error(`Compose service ${service} must use an image pinned by sha256 digest; found ${JSON.stringify(image)}.`);
    }
    return image;
  });
}

function assertImagesCached(images, env, context) {
  for (const image of images) {
    const result = spawn('docker', ['image', 'inspect', image], { env, label: `Docker image cache check for ${image}` });
    if (result.status !== 0) {
      const details = [
        `status=${result.status ?? 'unknown'}`,
        result.signal ? `signal=${result.signal}` : null,
        `stderr=${JSON.stringify(result.stderr?.trim() ?? '')}`,
      ].filter(Boolean).join(', ');
      throw new Error(`docker image inspect failed for Compose image ${image} on local context ${context} (${details}). No pull was attempted; verify this exact digest and the Docker daemon response before retrying.`);
    }
  }
}

function localProxyEnvironment(env) {
  return {
    ...env,
    HTTP_PROXY: proxyBlock,
    HTTPS_PROXY: proxyBlock,
    ALL_PROXY: proxyBlock,
    http_proxy: proxyBlock,
    https_proxy: proxyBlock,
    all_proxy: proxyBlock,
    NO_PROXY: 'localhost,127.0.0.1,::1,postgres',
    no_proxy: 'localhost,127.0.0.1,::1,postgres',
  };
}

function composeArgs(projectName, envFile, args) {
  return [
    'compose',
    '--project-name', projectName,
    '--env-file', envFile,
    '--project-directory', apiRoot,
    '-f', composeFile,
    ...args,
  ];
}

function publishedPort(compose, service, targetPort, dockerEnv) {
  const ids = compose(['ps', '--all', '--quiet', service]).split(/\r?\n/).filter(Boolean);
  if (ids.length !== 1) throw new Error(`Expected one task-owned ${service} container, found ${ids.length}.`);

  const portKey = `${targetPort}/tcp`;
  const rawBindings = runQuiet('docker', ['inspect', '--format', `{{json (index .NetworkSettings.Ports "${portKey}")}}`, ids[0]], { env: dockerEnv });
  let bindings;
  try {
    bindings = JSON.parse(rawBindings);
  } catch (cause) {
    throw new Error(`Docker returned invalid published-port data for ${service}:${targetPort}: ${rawBindings}`, { cause });
  }
  if (!Array.isArray(bindings) || bindings.length !== 1) {
    throw new Error(`Docker did not report exactly one published binding for ${service}:${targetPort}: ${rawBindings}`);
  }

  const [binding] = bindings;
  const port = Number(binding.HostPort);
  if (!['127.0.0.1', 'localhost', '::1'].includes(binding.HostIp) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Refusing non-loopback ${service} binding ${binding.HostIp}:${binding.HostPort}; HTTP tests may use only localhost.`);
  }
  return String(port);
}

function seedEnvironment({ database, user, password, port, psqlPath }) {
  const env = {
    ...process.env,
    HAPPYVIEW_DISPOSABLE_TEST_TARGET: 'YES',
    PGHOST: '127.0.0.1',
    PGPORT: port,
    PGDATABASE: database,
    PGUSER: user,
    PGPASSWORD: password,
    PGSSLMODE: 'disable',
    PSQL_PATH: psqlPath,
  };
  delete env.PGHOSTADDR;
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  return env;
}

function psql(psqlPath, env, input) {
  run(psqlPath, ['--no-psqlrc', '--quiet', '--set', 'ON_ERROR_STOP=1', ...psqlTargetArgs(env)], { env, input });
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function bootstrapAdmin(psqlPath, env, token) {
  const now = new Date().toISOString();
  const userId = randomUUID();
  const apiKeyId = randomUUID();
  const did = `did:web:http-${randomBytes(6).toString('hex')}.invalid`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const permissions = JSON.stringify([
    'lexicons:create',
    'lexicons:read',
    'script-variables:create',
    'script-variables:read',
    'scripts:read',
    'scripts:manage',
  ]);
  const sql = `
BEGIN;
INSERT INTO happyview_users (id, did, is_super, created_at)
  VALUES (${sqlString(userId)}, ${sqlString(did)}, 1, ${sqlString(now)});
INSERT INTO happyview_user_permissions (user_id, permission, granted_at)
  VALUES (${sqlString(userId)}, 'lexicons:create', ${sqlString(now)}),
         (${sqlString(userId)}, 'lexicons:read', ${sqlString(now)}),
         (${sqlString(userId)}, 'script-variables:create', ${sqlString(now)}),
         (${sqlString(userId)}, 'script-variables:read', ${sqlString(now)}),
         (${sqlString(userId)}, 'scripts:read', ${sqlString(now)}),
         (${sqlString(userId)}, 'scripts:manage', ${sqlString(now)});
INSERT INTO happyview_api_keys (id, user_id, name, key_hash, key_prefix, permissions, created_at)
  VALUES (${sqlString(apiKeyId)}, ${sqlString(userId)}, 'hypercerts HTTP test runner', ${sqlString(tokenHash)}, ${sqlString(token.slice(0, 11))}, ${sqlString(permissions)}, ${sqlString(now)});
COMMIT;
`;
  psql(psqlPath, env, sql);
}

async function waitForHealth(baseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Retry only the task-owned loopback HappyView health check.
    }
    await delay(500);
  }
  throw new Error(`Task-owned HappyView did not become healthy at ${baseUrl}/health within ${timeoutMs}ms.`);
}

function runHttpCases(files, env) {
  const relativeFiles = files.map((file) => path.relative(apiRoot, file));
  const result = spawn(process.execPath, ['--test', '--test-reporter=tap', ...relativeFiles], {
    cwd: apiRoot,
    env,
    timeoutMs: 90_000,
    label: 'Node HTTP test runner',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const tests = /^# tests (\d+)$/m.exec(result.stdout ?? '');
  const passed = /^# pass (\d+)$/m.exec(result.stdout ?? '');
  if (!tests) throw new Error('HTTP test runner produced no TAP test-count summary; refusing to treat file selection as executed HTTP coverage.');
  if (Number(tests[1]) === 0) throw new Error('Zero HTTP test cases executed; add actual node:test cases under tests/http.');
  if (result.status !== 0) throw new Error(`HTTP test cases failed with exit status ${result.status ?? 'unknown'}.`);
  if (!passed || Number(passed[1]) === 0) throw new Error('No HTTP test cases passed; skipped-only HTTP files do not satisfy runtime coverage.');
  process.stdout.write(`Verified ${tests[1]} executed HTTP cases (${passed[1]} passed) across ${files.length} suite files.\n`);
}

function teardownOwnedProject(compose, projectName, envFile, dockerEnv, composeEnv) {
  const ids = compose(['ps', '--all', '--quiet']).split(/\r?\n/).filter(Boolean);
  for (const id of ids) {
    const rawLabels = runQuiet('docker', ['inspect', '--format', '{{json .Config.Labels}}', id], { env: dockerEnv });
    const labels = JSON.parse(rawLabels);
    const configFiles = (labels['com.docker.compose.project.config_files'] ?? '').split(',').map((file) => path.resolve(file));
    if (labels['com.docker.compose.project'] !== projectName
      || !services.has(labels['com.docker.compose.service'])
      || !configFiles.includes(path.resolve(composeFile))) {
      throw new Error(`Refusing teardown: container ${id} is not owned by this task's Compose project and file.`);
    }
  }
  run('docker', composeArgs(projectName, envFile, ['down', '--volumes', '--timeout', '10']), { env: composeEnv });
}

async function prepareRun() {
  const psqlPath = requirePsqlPath();
  const suites = await findFiles(httpTestRoot, '.http.test.js');
  if (suites.length === 0) {
    throw new Error('No HTTP suites found under tests/http; add at least one *.http.test.js suite.');
  }
  const fixtureModules = await findFiles(fixtureRoot, '.fixture.js');
  const httpSeedRows = await loadFixtureRows(fixtureModules);

  const dockerEnv = dockerEnvironment();
  const dockerContext = assertLocalDocker(dockerEnv);

  const nonce = randomBytes(8).toString('hex');
  const projectName = `hypercerts-http-${process.pid}-${nonce}`;
  const postgresUser = `http_${process.pid}_${nonce}`;
  const postgresPassword = randomBytes(32).toString('hex');
  const postgresDatabase = `happyview_http_test_${process.pid}_${nonce}`;
  const sessionSecret = randomBytes(48).toString('hex');
  const tokenEncryptionKey = randomBytes(32).toString('base64');
  const adminToken = `hv_${randomBytes(24).toString('hex')}`;
  const composeEnv = {
    ...dockerEnv,
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: postgresPassword,
    POSTGRES_DB: postgresDatabase,
    SESSION_SECRET: sessionSecret,
    TOKEN_ENCRYPTION_KEY: tokenEncryptionKey,
  };

  const tempBase = process.env.RUNNER_TEMP ? path.resolve(process.env.RUNNER_TEMP) : os.tmpdir();
  const tempRoot = await mkdtemp(path.join(tempBase, 'hypercerts-http-'));
  const envFile = path.join(tempRoot, 'compose.env');
  await writeFile(envFile, [
    `POSTGRES_USER=${postgresUser}`,
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `POSTGRES_DB=${postgresDatabase}`,
    `SESSION_SECRET=${sessionSecret}`,
    `TOKEN_ENCRYPTION_KEY=${tokenEncryptionKey}`,
    '',
  ].join('\n'), { mode: 0o600 });

  const compose = (args) => runQuiet('docker', composeArgs(projectName, envFile, args), { env: composeEnv });
  return {
    psqlPath,
    suites,
    httpSeedRows,
    dockerEnv,
    dockerContext,
    projectName,
    postgresUser,
    postgresPassword,
    postgresDatabase,
    adminToken,
    composeEnv,
    tempRoot,
    envFile,
    compose,
    lifecycleState: { ownsProject: false, retainCredentials: false, failure: undefined },
  };
}

async function validateTaskProject(context) {
  const { lifecycleState } = context;
  let composeConfig;
  try {
    composeConfig = JSON.parse(context.compose(['config', '--format', 'json']));
  } catch (cause) {
    throw new Error(`Could not read the task Compose configuration before starting services: ${cause.message}`, { cause });
  }
  assertImagesCached(imagesFromComposeConfig(composeConfig), context.dockerEnv, context.dockerContext);
  if (context.compose(['ps', '--all', '--quiet'])) throw new Error(`Refusing to reuse non-empty Compose project ${context.projectName}.`);
  const networks = runQuiet('docker', ['network', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${context.projectName}`], { env: context.dockerEnv });
  const volumes = runQuiet('docker', ['volume', 'ls', '--quiet', '--filter', `label=com.docker.compose.project=${context.projectName}`], { env: context.dockerEnv });
  if (networks || volumes) throw new Error(`Refusing to reuse existing Docker resources for Compose project ${context.projectName}.`);
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `HYPERCERTS_HTTP_TEST_COMPOSE_PROJECT=${context.projectName}\nHYPERCERTS_HTTP_TEST_COMPOSE_ENV_FILE=${context.envFile}\n`);
  }

  lifecycleState.ownsProject = true;
}

function startTaskServices(context) {
  process.stdout.write(`Starting disposable local HTTP test project ${context.projectName} (cached images only).\n`);
  run('docker', composeArgs(context.projectName, context.envFile, ['up', '--pull', 'never', '--detach', '--wait', '--wait-timeout', '180']), {
    env: context.composeEnv,
    timeoutMs: 210_000,
    label: 'Task-owned Docker Compose startup',
  });
}

async function installAndSeedApi(context) {
  const postgresPort = publishedPort(context.compose, 'postgres', 5432, context.dockerEnv);
  const happyviewPort = publishedPort(context.compose, 'happyview', 3000, context.dockerEnv);
  const baseUrl = `http://127.0.0.1:${happyviewPort}`;
  await waitForHealth(baseUrl);

  const pgEnv = seedEnvironment({
    database: context.postgresDatabase,
    user: context.postgresUser,
    password: context.postgresPassword,
    port: postgresPort,
    psqlPath: context.psqlPath,
  });
  bootstrapAdmin(context.psqlPath, pgEnv, context.adminToken);

  const localEnv = localProxyEnvironment(process.env);
  const installerEnv = {
    ...localEnv,
    HAPPYVIEW_BASE_URL: baseUrl,
    HAPPYVIEW_ADMIN_TOKEN: context.adminToken,
    HYPERCERTS_HANDLE_RESOLVER_URL: 'https://resolver.invalid',
  };
  run('pnpm', ['--filter', '@hypercerts-org/hypercerts-api', 'run', 'install:api'], {
    env: installerEnv,
    timeoutMs: 180_000,
    label: 'Checkout API manifest install into disposable HappyView',
  });

  psql(context.psqlPath, pgEnv, buildSeedInput(pgEnv));
  psql(context.psqlPath, pgEnv, buildSeedInput(pgEnv, context.httpSeedRows));
  return baseUrl;
}

function runHttpSuites(context, baseUrl) {
  const testEnv = {
    ...localProxyEnvironment(process.env),
    HAPPYVIEW_BASE_URL: baseUrl,
  };
  process.stdout.write(`Running ${context.suites.length} HTTP suite files against ${baseUrl}.\n`);
  runHttpCases(context.suites, testEnv);
}

async function runHttpLifecycle(context) {
  await validateTaskProject(context);
  startTaskServices(context);
  const baseUrl = await installAndSeedApi(context);
  runHttpSuites(context, baseUrl);
}

function reportRunFailure(error, context) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  if (!context.lifecycleState.ownsProject) return;
  try {
    const logs = spawn('docker', composeArgs(context.projectName, context.envFile, ['logs', '--no-color', '--timestamps', '--tail', '100']), { env: context.composeEnv });
    if (logs.stdout) process.stderr.write(logs.stdout);
    if (logs.stderr) process.stderr.write(logs.stderr);
  } catch (logError) {
    process.stderr.write(`Unable to collect task-owned Compose logs: ${logError instanceof Error ? logError.message : String(logError)}\n`);
  }
}

async function cleanupRun(context) {
  const { lifecycleState } = context;
  if (lifecycleState.ownsProject) {
    try {
      teardownOwnedProject(context.compose, context.projectName, context.envFile, context.dockerEnv, context.composeEnv);
    } catch (cleanupError) {
      process.stderr.write(`Task-owned Compose teardown failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`);
      lifecycleState.failure ??= cleanupError;
      lifecycleState.retainCredentials = true;
    }
  }
  if (lifecycleState.retainCredentials) {
    const recovery = process.env.GITHUB_ENV ? 'the workflow always-cleanup step will retry' : 'retain it for task-scoped manual cleanup';
    process.stderr.write(`Retaining task-owned temporary credentials at ${context.envFile}; ${recovery}.\n`);
  } else {
    try {
      await rm(context.tempRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      process.stderr.write(`Unable to remove task-owned temporary credentials: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`);
      lifecycleState.failure ??= cleanupError;
    }
  }
}

async function main() {
  const context = await prepareRun();
  try {
    await runHttpLifecycle(context);
  } catch (error) {
    context.lifecycleState.failure = error;
    reportRunFailure(error, context);
  } finally {
    await cleanupRun(context);
  }

  if (context.lifecycleState.failure) process.exitCode = 1;
}

await main();
