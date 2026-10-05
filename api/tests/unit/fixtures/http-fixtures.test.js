import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { locationRecords, profileRecords, organizationRecords } from '../../fixtures/records.js';
import {
  actorFollowRecords,
  actorFollowProfileRecords,
  actorFollowOrganizationRecords,
} from '../../fixtures/actor-follows.js';
import { activityFixtureRows } from '../../fixtures/activities.js';

const httpFixtureRoot = fileURLToPath(new URL('../../http/fixtures/', import.meta.url));
const sharedSeedRows = [
  ...locationRecords,
  ...profileRecords,
  ...organizationRecords,
  ...actorFollowRecords,
  ...actorFollowProfileRecords,
  ...actorFollowOrganizationRecords,
  ...activityFixtureRows,
];

function compareNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

async function findFixtureModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort(compareNames);
  const groups = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFixtureModules(entryPath);
    if (entry.isFile() && entry.name.endsWith('.fixture.js')) return [entryPath];
    return [];
  }));
  return groups.flat();
}

async function loadHttpFixtureRows() {
  const fixtureModules = await findFixtureModules(httpFixtureRoot);
  assert.ok(fixtureModules.length > 0, 'expected recursively discovered HTTP fixture modules');
  const rows = [];
  for (const file of fixtureModules) {
    const fixture = await import(pathToFileURL(file).href);
    assert.ok(Array.isArray(fixture.seedRows) && fixture.seedRows.length > 0, `${file} must export nonempty seedRows`);
    rows.push(...fixture.seedRows);
  }
  return rows;
}

function assertUnique(rows, keyOf, description) {
  const firstRowByKey = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const first = firstRowByKey.get(key);
    assert.equal(firstRowByKey.has(key), false, `duplicate ${description} ${key}: ${first?.uri} and ${row.uri}`);
    firstRowByKey.set(key, row);
  }
}

test('shared and recursively discovered HTTP fixtures have unique identities and valid CBOR CIDs', async () => {
  const rows = [...sharedSeedRows, ...await loadHttpFixtureRows()];

  assertUnique(rows, ({ uri }) => uri, 'fixture AT-URI');
  assertUnique(rows, ({ did, collection, rkey }) => JSON.stringify([did, collection, rkey]), 'fixture DID/collection/rkey identity');

  for (const row of rows) {
    assert.equal(row.uri, `at://${row.did}/${row.collection}/${row.rkey}`, `malformed AT-URI for ${row.uri}`);
    const derivedCid = CID.toString(await CID.create(0x71, encode(row.record)));
    assert.equal(row.cid, derivedCid, `CID must be derived from CBOR record content for ${row.uri}`);
  }
});
