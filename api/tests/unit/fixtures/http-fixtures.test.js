import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
import { locationRecords, profileRecords, organizationRecords } from '../../fixtures/records.js';
import {
  actorFollowRecords,
  actorFollowProfileRecords,
  actorFollowOrganizationRecords,
} from '../../fixtures/actor-follows.js';
import { activityFixtureRows } from '../../fixtures/activities.js';

const httpFixtureRoot = fileURLToPath(new URL('../../http/fixtures/', import.meta.url));

function compareEntryNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

async function findFixtureModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort(compareEntryNames);
  const groups = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFixtureModules(entryPath);
    if (entry.isFile() && entry.name.endsWith('.fixture.js')) return [entryPath];
    return [];
  }));
  return groups.flat();
}

test('shared and recursively discovered HTTP fixture rows have unique identities and CBOR-derived CIDs', async () => {
  const fixtureModules = await findFixtureModules(httpFixtureRoot);
  assert.ok(fixtureModules.length > 0, 'expected HTTP fixture modules under tests/http/fixtures');

  const httpRows = [];
  for (const file of fixtureModules) {
    const fixture = await import(pathToFileURL(file).href);
    assert.ok(Array.isArray(fixture.seedRows) && fixture.seedRows.length > 0,
      `${path.relative(httpFixtureRoot, file)} must export nonempty seedRows`);
    httpRows.push(...fixture.seedRows);
  }

  const sharedRows = [
    ...locationRecords,
    ...profileRecords,
    ...organizationRecords,
    ...actorFollowRecords,
    ...actorFollowProfileRecords,
    ...actorFollowOrganizationRecords,
    ...activityFixtureRows,
  ];
  const rows = [...sharedRows, ...httpRows];
  const uris = new Set();
  const identities = new Set();

  for (const row of rows) {
    assert.equal(row.uri, `at://${row.did}/${row.collection}/${row.rkey}`);
    assert.ok(!uris.has(row.uri), `duplicate fixture URI: ${row.uri}`);
    uris.add(row.uri);

    const identity = JSON.stringify([row.did, row.collection, row.rkey]);
    assert.ok(!identities.has(identity), `duplicate fixture (DID, collection, rkey): ${identity}`);
    identities.add(identity);
  }

  for (const row of rows) {
    const expectedCid = CID.toString(await CID.create(0x71, encode(row.record)));
    assert.equal(row.cid, expectedCid, `fixture CID does not match CBOR record: ${row.uri}`);
  }
});
