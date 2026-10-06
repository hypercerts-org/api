import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
import { locationRecords, profileRecords, organizationRecords } from '../../fixtures/records.js';
import { activityFixtureRows } from '../../fixtures/activities.js';
import {
  actorFollowOrganizationRecords,
  actorFollowProfileRecords,
  actorFollowRecords,
} from '../../fixtures/actor-follows.js';

const apiRoot = fileURLToPath(new URL('../../../', import.meta.url));
const httpFixtureRoot = path.join(apiRoot, 'tests', 'http', 'fixtures');

async function findFixtureModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const groups = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return findFixtureModules(file);
    if (entry.isFile() && entry.name.endsWith('.fixture.js')) return [file];
    return [];
  }));
  return groups.flat();
}

async function loadHttpSeedRows() {
  const modules = await findFixtureModules(httpFixtureRoot);
  assert.ok(modules.length > 0, 'expected recursively discovered HTTP fixture modules');
  const fixtures = [];
  for (const file of modules) {
    const fixture = await import(pathToFileURL(file).href);
    assert.ok(Array.isArray(fixture.seedRows) && fixture.seedRows.length > 0,
      `${path.relative(apiRoot, file)} must export nonempty seedRows`);
    fixtures.push(...fixture.seedRows.map((row) => ({ row, source: path.relative(apiRoot, file) })));
  }
  return fixtures;
}

function duplicateDetails(previous, current) {
  const previousCbor = encode(previous.row.record);
  const currentCbor = encode(current.row.record);
  return {
    identity: [current.row.did, current.row.collection, current.row.rkey],
    uri: current.row.uri,
    sources: [previous.source, current.source],
    cids: [previous.row.cid, current.row.cid],
    sameCborContent: Buffer.from(previousCbor).equals(Buffer.from(currentCbor)),
    sameCid: previous.row.cid === current.row.cid,
  };
}

test('shared and discovered HTTP seed rows preserve acknowledgement sidecar isolation, unique identities, and CBOR-derived CIDs', async () => {
  const rows = [
    ...[
      ...locationRecords, ...profileRecords, ...organizationRecords,
      ...actorFollowRecords, ...actorFollowProfileRecords, ...actorFollowOrganizationRecords,
      ...activityFixtureRows,
    ].map((row) => ({ row, source: 'shared seed rows' })),
    ...await loadHttpSeedRows(),
  ];
  const acknowledgementRows = rows.filter(({ row }) => row.collection === 'org.hypercerts.context.acknowledgement');
  const acknowledgementDids = new Set(acknowledgementRows.map(({ row }) => row.did));
  const acknowledgementSources = new Set(acknowledgementRows.map(({ source }) => source));
  const sharedAcknowledgementSidecars = rows
    .filter(({ row, source }) => acknowledgementDids.has(row.did)
      && !acknowledgementSources.has(source)
      && ['app.certified.actor.profile', 'app.certified.actor.organization'].includes(row.collection))
    .map(({ row, source }) => ({ did: row.did, collection: row.collection, uri: row.uri, source }));
  assert.deepEqual(sharedAcknowledgementSidecars, [],
    'acknowledgement publishers must not share actor-sidecar DIDs with other fixture sources because seed upserts can overwrite those rows');

  for (const rkey of ['ack-middle-b', 'ack-author-negative']) {
    const acknowledgement = rows.find(({ row }) =>
      row.collection === 'org.hypercerts.context.acknowledgement' && row.rkey === rkey);
    assert.ok(acknowledgement, `expected acknowledgement fixture ${rkey}`);
    const sidecars = rows.filter(({ row }) => row.did === acknowledgement.row.did
      && ['app.certified.actor.profile', 'app.certified.actor.organization'].includes(row.collection));
    assert.deepEqual(sidecars.map(({ row }) => row.uri), [],
      `${rkey} publisher must have no profile or organization sidecars in shared or HTTP fixtures`);
  }

  const byUri = new Map();
  const byIdentity = new Map();
  const duplicateUris = [];
  const duplicateIdentities = [];

  for (const entry of rows) {
    const { row, source } = entry;
    const canonicalUri = `at://${row.did}/${row.collection}/${row.rkey}`;
    assert.equal(row.uri, canonicalUri, `${source} has a noncanonical AT-URI`);
    assert.equal(row.record.$type, row.collection, `${source} record type does not match its collection`);
    const computedCid = CID.toString(await CID.create(0x71, encode(row.record)));
    assert.equal(row.cid, computedCid, `${source} ${row.uri} CID does not match its CBOR record`);

    const identity = JSON.stringify([row.did, row.collection, row.rkey]);
    if (byUri.has(row.uri)) duplicateUris.push(duplicateDetails(byUri.get(row.uri), entry));
    else byUri.set(row.uri, entry);
    if (byIdentity.has(identity)) duplicateIdentities.push(duplicateDetails(byIdentity.get(identity), entry));
    else byIdentity.set(identity, entry);
  }

  assert.deepEqual(
    { duplicateUris, duplicateIdentities },
    { duplicateUris: [], duplicateIdentities: [] },
    'shared and HTTP seed rows must not overwrite one another by canonical URI or repository identity',
  );
});
