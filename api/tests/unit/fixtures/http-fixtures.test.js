import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
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

test('shared and recursively discovered HTTP fixtures have unique identities and valid CBOR CIDs', async () => {
  const records = sharedSeedRows.map((row) => ({ source: 'shared fixtures', row }));
  const fixtureModules = await findFixtureModules(httpFixtureRoot);
  assert.ok(fixtureModules.length > 0, 'expected recursively discovered HTTP fixture modules');

  for (const file of fixtureModules) {
    const fixture = await import(pathToFileURL(file).href);
    assert.ok(Array.isArray(fixture.seedRows) && fixture.seedRows.length > 0, `${file} must export nonempty seedRows`);
    records.push(...fixture.seedRows.map((row) => ({ source: file, row })));
  }

  const uris = new Map();
  const identities = new Map();
  for (const { source, row } of records) {
    const identity = JSON.stringify([row.did, row.collection, row.rkey]);
    const uri = `at://${row.did}/${row.collection}/${row.rkey}`;
    assert.equal(row.uri, uri, `${source} has an inconsistent URI for ${identity}`);
    assert.equal(uris.has(row.uri), false, `${row.uri} is seeded by both ${uris.get(row.uri)} and ${source}`);
    assert.equal(identities.has(identity), false, `${identity} is seeded by both ${identities.get(identity)} and ${source}`);
    uris.set(row.uri, source);
    identities.set(identity, source);
    const derivedCid = CID.toString(await CID.create(0x71, encode(row.record)));
    assert.equal(row.cid, derivedCid, `${source} has a non-CBOR-derived CID for ${row.uri}`);
  }
});
