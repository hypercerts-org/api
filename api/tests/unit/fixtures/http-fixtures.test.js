import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { locationRecords, profileRecords, organizationRecords } from '../../fixtures/records.js';
import { actorFollowRecords, actorFollowProfileRecords, actorFollowOrganizationRecords } from '../../fixtures/actor-follows.js';
import { activityFixtureRows } from '../../fixtures/activities.js';

const httpFixtureRoot = fileURLToPath(new URL('../../../tests/http/fixtures/', import.meta.url));
const sharedSeedRows = [
  ...locationRecords,
  ...profileRecords,
  ...organizationRecords,
  ...actorFollowRecords,
  ...actorFollowProfileRecords,
  ...actorFollowOrganizationRecords,
  ...activityFixtureRows,
];

function compareEntryNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

async function findFixtureFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort(compareEntryNames);
  const groups = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFixtureFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.fixture.js') ? [entryPath] : [];
  }));
  return groups.flat();
}

test('shared and recursively discovered HTTP seed rows have unique identities and matching CBOR CIDs', async () => {
  const fixtureModules = await findFixtureFiles(httpFixtureRoot);
  assert.ok(fixtureModules.length > 0, 'expected recursively discovered HTTP fixture modules');

  const httpSeedRows = [];
  for (const file of fixtureModules) {
    const fixture = await import(pathToFileURL(file).href);
    assert.ok(Array.isArray(fixture.seedRows) && fixture.seedRows.length > 0, `${file} must export nonempty seedRows`);
    httpSeedRows.push(...fixture.seedRows);
  }

  const seedRows = [...sharedSeedRows, ...httpSeedRows];
  for (const row of seedRows) {
    assert.equal(CID.toString(await CID.create(0x71, encode(row.record))), row.cid, `CBOR CID mismatch for ${row.uri}`);
  }

  const uris = new Set();
  const identities = new Set();
  for (const row of seedRows) {
    assert.equal(uris.has(row.uri), false, `Duplicate fixture URI: ${row.uri}`);
    uris.add(row.uri);

    const identity = JSON.stringify([row.did, row.collection, row.rkey]);
    assert.equal(identities.has(identity), false, `Duplicate fixture identity: ${identity}`);
    identities.add(identity);
  }
});
