import { spawnSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { seedSql, locationRecords, profileRecords, organizationRecords } from '../tests/fixtures/records.js';
import { actorFollowRecords, actorFollowProfileRecords, actorFollowOrganizationRecords } from '../tests/fixtures/actor-follows.js';
import { activityFixtureRows } from '../tests/fixtures/activities.js';
import { badDateSeedSql } from '../tests/fixtures/bad-dates.js';
import { badDateLocations } from '../tests/fixtures/bad-location-dates.js';

/** @typedef {{ uri: string; did: string; collection: string; rkey: string; cid: string; indexedAt: string; record: Record<string, unknown> }} SeedRow */
/** @typedef {Omit<SeedRow, 'indexedAt'> & { indexedAt: string | null; storedAt: string }} DateFixtureRow */

/** @param {NodeJS.ProcessEnv} env @returns {{ host: string; port: number; database: string; user: string | undefined }} */
function disposableTarget(env) {
  if (env.HAPPYVIEW_DISPOSABLE_TEST_TARGET !== 'YES') throw new Error('Set HAPPYVIEW_DISPOSABLE_TEST_TARGET=YES only after confirming this is a disposable test database');
  if (env.PGHOSTADDR || env.PGSERVICE || env.PGSERVICEFILE) throw new Error('PGHOSTADDR, PGSERVICE, and PGSERVICEFILE are not allowed; they can override the loopback seed target');
  if (!env.PGDATABASE || !/^\w[\w-]*$/.test(env.PGDATABASE) || !/(^|[_-])test([_-]|$)/i.test(env.PGDATABASE)) {
    throw new Error('PGDATABASE must be a simple database name containing a test marker (for example happyview_test), not a URI or conninfo string');
  }
  const host = env.PGHOST;
  if (typeof host !== 'string' || !['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Set PGHOST explicitly to localhost, 127.0.0.1, or ::1');
  const port = env.PGPORT === undefined ? 5432 : Number(env.PGPORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PGPORT must be an integer from 1 to 65535');
  return { host, port, database: env.PGDATABASE, user: env.PGUSER };
}

/** @param {unknown} value @returns {string} */
function quote(value) {
  if (value === null) return 'NULL';
  const escapedBackslash = String.raw`\\`;
  return `E'${String(value).replaceAll('\\', escapedBackslash).replaceAll("'", "''")}'`;
}

/** @param {{ sql: string; params: unknown[] }[]} statements @param {string} [types] @returns {string} */
function sqlInput(statements, types = 'text, text, text, text, jsonb, text, text') {
  const [firstStatement] = statements;
  if (!firstStatement) throw new Error('Seed SQL requires at least one statement; provide a nonempty fixture row set');
  return [
    String.raw`\set ON_ERROR_STOP on`,
    `PREPARE happyview_fixture (${types}) AS ${firstStatement.sql};`,
    ...statements.map(({ params }) => `EXECUTE happyview_fixture(${params.map(quote).join(', ')});`),
    'DEALLOCATE happyview_fixture;',
  ].join('\n');
}

/** @param {NodeJS.ProcessEnv} [env] @param {SeedRow[]} [rows] @returns {string} */
export function buildSeedInput(env = process.env, rows = [
  ...locationRecords, ...profileRecords, ...organizationRecords,
  ...actorFollowRecords, ...actorFollowProfileRecords, ...actorFollowOrganizationRecords,
  ...activityFixtureRows,
]) {
  disposableTarget(env);
  return sqlInput(seedSql(rows, { disposableTestTarget: true }));
}

/** @param {NodeJS.ProcessEnv} [env] @param {DateFixtureRow[]} [rows] @returns {string} */
export function buildBadDateSeedInput(env = process.env, rows = badDateLocations) {
  disposableTarget(env);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Seeding requires at least one fixture row; supply a nonempty rows array');
  return sqlInput(badDateSeedSql(rows, { disposableTestTarget: true }), 'text, text, text, text, jsonb, text, text, text');
}

/** @param {NodeJS.ProcessEnv} env @returns {string} */
function configuredPsqlPath(env) {
  const executable = env.PSQL_PATH;
  if (!executable || !path.isAbsolute(executable)) {
    throw new Error('Set PSQL_PATH to the absolute path of a trusted psql executable; PATH lookup is not allowed');
  }
  try {
    if (!statSync(executable).isFile()) throw new Error('not a regular file');
    accessSync(executable, constants.X_OK);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`PSQL_PATH must point to an existing executable file (${executable}): ${detail}`, { cause: error });
  }
  return executable;
}

/** @param {NodeJS.ProcessEnv} [env] @returns {string[]} */
export function psqlTargetArgs(env = process.env) {
  const target = disposableTarget(env);
  const args = ['--host', target.host, '--port', String(target.port), '--dbname', target.database];
  if (target.user) args.push('--username', target.user);
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = process.argv.slice(2);
    if (options.length > 1 || (options.length === 1 && options[0] !== '--bad-dates')) {
      throw new Error(`Unknown seed option: ${options.join(' ')}; use --bad-dates only to seed invalid-date fixtures`);
    }
    const input = options.length === 1 ? buildBadDateSeedInput() : buildSeedInput();
    const args = ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', ...psqlTargetArgs()];
    const executable = configuredPsqlPath(process.env);
    /** @type {NodeJS.ProcessEnv} */
    const env = { ...process.env };
    delete env.PGHOSTADDR;
    delete env.PGSERVICE;
    delete env.PGSERVICEFILE;
    const result = spawnSync(executable, args, { input, encoding: 'utf8', env, stdio: ['pipe', 'inherit', 'inherit'], shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`psql failed with exit status ${result.status}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
