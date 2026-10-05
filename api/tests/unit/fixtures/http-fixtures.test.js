import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { locationRecords, profileRecords, organizationRecords } from '../../fixtures/records.js';
import { actorFollowRecords, actorFollowProfileRecords, actorFollowOrganizationRecords } from '../../fixtures/actor-follows.js';
import { activityFixtureRows } from '../../fixtures/activities.js';

const httpFixtureRoot = fileURLToPath(new URL('../../http/fixtures/', import.meta.url));
const sharedRows = [
  ...locationRecords, ...profileRecords, ...organizationRecords,
  ...actorFollowRecords, ...actorFollowProfileRecords, ...actorFollowOrganizationRecords,
  ...activityFixtureRows,
];

async function findFixtureModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const fileGroups = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFixtureModules(entryPath);
    if (entry.isFile() && entry.name.endsWith('.fixture.js')) return [entryPath];
    return [];
  }));
  return fileGroups.flat();
}

test('shared and discovered HTTP fixture records have unique identities and CBOR-derived CIDs', async () => {
  const records = sharedRows.map((row) => ({ source: 'shared fixtures', row }));
  const fixtureModules = await findFixtureModules(httpFixtureRoot);
  assert.ok(fixtureModules.length > 0, 'expected discovered HTTP fixture modules');

  for (const file of fixtureModules) {
    const { seedRows } = await import(pathToFileURL(file).href);
    assert.ok(Array.isArray(seedRows) && seedRows.length > 0, `${file} must export nonempty seedRows`);
    records.push(...seedRows.map((row) => ({ source: file, row })));
  }

  const uris = new Map();
  const identities = new Map();
  for (const { source, row } of records) {
    const identity = `${row.did}/${row.collection}/${row.rkey}`;
    assert.equal(row.uri, `at://${identity}`, `${source} has an inconsistent URI for ${identity}`);
    assert.equal(uris.has(row.uri), false, `${row.uri} is seeded by both ${uris.get(row.uri)} and ${source}`);
    assert.equal(identities.has(identity), false, `${identity} is seeded by both ${identities.get(identity)} and ${source}`);
    uris.set(row.uri, source);
    identities.set(identity, source);
    assert.equal(CID.toString(await CID.create(0x71, encode(row.record))), row.cid, `${source} has a non-CBOR-derived CID for ${row.uri}`);
  }
});
