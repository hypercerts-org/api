import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
import { isValidDid, isValidTid } from '@atproto/syntax';
import { locationRecords, profileRecords, organizationRecords, seedSql } from '../../fixtures/records.js';
import { activityContributorInformationVersions, activityFixtureRows } from '../../fixtures/activities.js';
import { seedRows as activityHttpFixtureRows } from '../../http/fixtures/activity.fixture.js';
import { seedRows as acknowledgementHttpFixtureRows } from '../../http/fixtures/acknowledgements.fixture.js';
import { seedRows as actorsHttpFixtureRows } from '../../http/fixtures/actors.fixture.js';
import { seedRows as badgeHttpFixtureRows } from '../../http/fixtures/badge-definitions.fixture.js';
import { seedRows as collectionHttpFixtureRows } from '../../http/fixtures/collections.fixture.js';
import { seedRows as contextAttachmentHttpFixtureRows } from '../../http/fixtures/context-attachments.fixture.js';
import { seedRows as contextEvaluationHttpFixtureRows } from '../../http/fixtures/context-evaluations.fixture.js';
import { seedRows as fundingHttpFixtureRows } from '../../http/fixtures/funding-receipts.fixture.js';
import { seedRows as graphFollowHttpFixtureRows } from '../../http/fixtures/graph-follows.fixture.js';
import { seedRows as locationHttpFixtureRows } from '../../http/fixtures/location.fixture.js';
import {
  actorFollowDids,
  actorFollowOrganizationRecords,
  actorFollowProfileRecords,
  actorFollowRecords,
} from '../../fixtures/actor-follows.js';

const httpFixtureRoot = fileURLToPath(new URL('../../http/fixtures/', import.meta.url));

function compareEntryNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

async function findHttpFixtureFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort(compareEntryNames);
  const groups = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findHttpFixtureFiles(entryPath);
    if (entry.isFile() && entry.name.endsWith('.fixture.js')) return [entryPath];
    return [];
  }));
  return groups.flat();
}

function duplicateKeys(rows, keyFor) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const key = keyFor(row);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].sort();
}
test('fixtures have consistent full AT-URIs, valid DID/TID/CID identifiers, types, and fixed timestamps', () => {
  const records = [
    ...locationRecords, ...profileRecords, ...organizationRecords,
    ...actorFollowRecords, ...actorFollowProfileRecords, ...actorFollowOrganizationRecords,
    ...activityFixtureRows, ...activityHttpFixtureRows,
  ];
  for (const row of records) {
    assert.equal(row.uri, `at://${row.did}/${row.collection}/${row.rkey}`);
    assert.equal(row.record.$type, row.collection);
    assert.equal(isValidDid(row.did), true);
    if (['app.certified.location', 'app.certified.graph.follow', 'org.hypercerts.claim.activity', 'org.hypercerts.claim.contributorInformation'].includes(row.collection)) assert.equal(isValidTid(row.rkey), true);
    const cid = CID.fromString(row.cid);
    assert.equal(cid.version, 1);
    assert.equal(cid.codec, 0x71);
    assert.equal(cid.digest.codec, 0x12);
    assert.equal(cid.digest.contents.length, 32);
    assert.equal(row.indexedAt, '2025-01-02T03:04:05.000Z');
  }
});

test('shared and recursively discovered HTTP seed rows are nonempty, unique against shared fixtures, and use CBOR-derived CIDs', async () => {
  const sharedRows = [
    ...locationRecords, ...profileRecords, ...organizationRecords,
    ...actorFollowRecords, ...actorFollowProfileRecords, ...actorFollowOrganizationRecords,
    ...activityFixtureRows,
  ];
  const fixtureFiles = await findHttpFixtureFiles(httpFixtureRoot);
  assert.ok(fixtureFiles.length > 0, 'expected recursively discovered HTTP fixture modules');

  const httpRows = [];
  for (const file of fixtureFiles) {
    const fixture = await import(pathToFileURL(file).href);
    assert.ok(Array.isArray(fixture.seedRows) && fixture.seedRows.length > 0, `${path.relative(httpFixtureRoot, file)} must export nonempty seedRows`);
    httpRows.push(...fixture.seedRows);
  }

  const allRows = [...sharedRows, ...httpRows];
  for (const rkey of ['ack-middle-b', 'ack-author-negative']) {
    const acknowledgement = acknowledgementHttpFixtureRows.find((row) => row.rkey === rkey);
    assert.ok(acknowledgement, `expected acknowledgement fixture ${rkey}`);
    const sidecars = allRows.filter(({ did, collection }) => did === acknowledgement.did
      && ['app.certified.actor.profile', 'app.certified.actor.organization'].includes(collection));
    assert.deepEqual(sidecars.map(({ uri }) => uri), [],
      `${rkey} publisher must have no profile or organization sidecars in shared or HTTP fixtures`);
  }

  for (const row of allRows) {
    assert.equal(row.uri, `at://${row.did}/${row.collection}/${row.rkey}`);
  }
  assert.deepEqual(duplicateKeys(allRows, ({ uri }) => uri), [], 'seed rows must not overwrite another record URI');
  assert.deepEqual(
    duplicateKeys(allRows, ({ did, collection, rkey }) => JSON.stringify([did, collection, rkey])),
    [],
    'seed rows must not reuse another record identity',
  );
  for (const row of allRows) {
    assert.equal(row.record.$type, row.collection);
    assert.equal(CID.toString(await CID.create(0x71, encode(row.record))), row.cid, `CBOR-derived CID mismatch for ${row.uri}`);
  }
});
test('activity HTTP fixture repositories do not collide with other fixture repositories', () => {
  const existingRows = [
    ...locationRecords, ...profileRecords, ...organizationRecords,
    ...actorFollowRecords, ...actorFollowProfileRecords, ...actorFollowOrganizationRecords,
    ...activityFixtureRows, ...contextAttachmentHttpFixtureRows, ...contextEvaluationHttpFixtureRows,
    ...graphFollowHttpFixtureRows, ...fundingHttpFixtureRows, ...badgeHttpFixtureRows,
    ...actorsHttpFixtureRows, ...collectionHttpFixtureRows, ...locationHttpFixtureRows,
  ];
  const existingDids = new Set(existingRows.map(({ did }) => did));
  const activityHttpDids = new Set(activityHttpFixtureRows.map(({ did }) => did));
  assert.deepEqual([...activityHttpDids].filter((did) => existingDids.has(did)), []);
  assert.equal(new Set(activityHttpFixtureRows.map(({ uri }) => uri)).size, activityHttpFixtureRows.length);
});
test('actor-follow fixtures isolate publishers and cover date precedence, URI ties, and sparse sidecars', async () => {
  const publishers = new Set([actorFollowDids.publisher, actorFollowDids.otherPublisher]);
  assert.equal(publishers.size, 2);
  assert.equal(new Set(actorFollowRecords.map(({ uri }) => uri)).size, 7);
  assert.deepEqual(
    actorFollowRecords.filter(({ did, record }) => did === actorFollowDids.publisher && record.subject === actorFollowDids.primarySubject)
      .map(({ rkey }) => rkey).sort(),
    ['3jzfcijpj2z2a', '3jzfcijpj2z2b', '3jzfcijpj2z2c'],
  );
  const primaryPair = new Map(actorFollowRecords
    .filter(({ did, record }) => did === actorFollowDids.publisher && record.subject === actorFollowDids.primarySubject)
    .map((record) => [record.rkey, record]));
  assert.equal(primaryPair.get('3jzfcijpj2z2a').record.createdAt, '2025-01-04T00:00:00.000Z');
  assert.equal(primaryPair.get('3jzfcijpj2z2b').record.createdAt, '2025-01-01T00:00:00.000Z');
  assert.equal(primaryPair.get('3jzfcijpj2z2c').record.createdAt, '2025-01-01T00:00:00.000Z');
  assert.ok(primaryPair.get('3jzfcijpj2z2b').uri < primaryPair.get('3jzfcijpj2z2c').uri);
  assert.deepEqual(Object.keys(primaryPair.get('3jzfcijpj2z2b').record.via).sort(), ['cid', 'uri']);
  assert.deepEqual(actorFollowProfileRecords.map(({ did }) => did).sort(), [
    actorFollowDids.primarySubject, actorFollowDids.publisher, actorFollowDids.secondSubject,
  ].sort());
  assert.deepEqual(actorFollowOrganizationRecords.map(({ did }) => did).sort(), [
    actorFollowDids.primarySubject, actorFollowDids.publisher,
  ].sort());
  for (const row of [...actorFollowRecords, ...actorFollowProfileRecords, ...actorFollowOrganizationRecords]) {
    assert.equal(CID.toString(await CID.create(0x71, encode(row.record))), row.cid);
  }
});

test('activity fixtures preserve a stale strong reference while seeding only the newer URI version', async () => {
  const [stale, latest] = activityContributorInformationVersions;
  assert.equal(stale.uri, latest.uri);
  assert.notEqual(stale.cid, latest.cid);
  assert.equal(activityFixtureRows.some(({ uri, cid }) => uri === stale.uri && cid === stale.cid), false);
  assert.equal(activityFixtureRows.some(({ uri, cid }) => uri === latest.uri && cid === latest.cid), true);
  for (const fixture of activityFixtureRows) {
    assert.equal(CID.toString(await CID.create(0x71, encode(fixture.record))), fixture.cid);
  }
});

test('location fixtures cover the smallBlob union variant with a shaped blob reference', () => {
  const fixture = locationRecords.find(({ record }) => record.location?.$type === 'org.hypercerts.defs#smallBlob');
  assert.ok(fixture, 'expected a location fixture using the smallBlob union variant');
  assert.equal(fixture.cid, 'bafyreibttgrp2qdif53ifsfdzndmshje7aqjy6ybiddbu2pwgrwlwctxsm');
  assert.deepEqual(fixture.record.location.blob, {
    $type: 'blob',
    ref: { $link: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy' },
    mimeType: 'application/geo+json',
    size: 68,
  });
});

test('fixture loader requires explicit disposable-target opt-in and parameterizes records only', () => {
  const records = [...locationRecords, ...profileRecords, ...organizationRecords, ...activityFixtureRows];
  assert.throws(() => seedSql(records, {}), /explicit disposable-test target opt-in/);
  const statements = seedSql(records, { disposableTestTarget: true });
  assert.equal(statements.length, records.length);
  for (const { sql, params } of statements) {
    assert.match(sql, /INSERT INTO happyview_records/);
    assert.doesNotMatch(sql, /DELETE|TRUNCATE|DROP/i);
    assert.equal(params.length, 7);
    assert.doesNotMatch(sql, /\bat:\/\//);
  }
});

test('seedSql converts only supplied rows, including another collection', () => {
  const custom = {
    uri: 'at://did:web:custom.example/org.hypercerts.custom/item',
    did: 'did:web:custom.example', collection: 'org.hypercerts.custom', rkey: 'item',
    record: { $type: 'org.hypercerts.custom', name: 'Custom' },
    cid: 'bafycustom', indexedAt: '2025-01-02T03:04:05.000Z',
  };
  const statements = seedSql([custom], { disposableTestTarget: true });
  assert.equal(statements.length, 1);
  assert.deepEqual(statements[0].params, [custom.uri, custom.did, custom.collection, custom.rkey, '{"$type":"org.hypercerts.custom","name":"Custom"}', custom.cid, custom.indexedAt]);
  assert.match(statements[0].sql, /INSERT INTO happyview_records/);
});
