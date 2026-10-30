import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const endpoint = 'org.hypercerts.context.getMeasurement';
const listEndpoint = 'org.hypercerts.context.listMeasurements';
const collection = 'org.hypercerts.context.measurement';
const publisher = 'did:plc:measurementhttpfixtureaa';
const publisherB = 'did:plc:measurementhttpfixturebb';
const measurer = 'did:plc:oooooooooooooooooooooooo';
const measurementUri = `at://${publisher}/${collection}/3jzfcijpj2z2a`;
const measurementUris = {
  a: measurementUri,
  b: `at://${publisher}/${collection}/3jzfcijpj2z2b`,
  c: `at://${publisher}/${collection}/3jzfcijpj2z2c`,
  d: `at://${publisherB}/${collection}/3jzfcijpj2z2d`,
};
const subjectUri = 'at://did:plc:gggggggggggggggggggggggg/org.hypercerts.claim.activity/3jzfcijpj2z2i';
const otherSubjectUri = 'at://did:plc:gggggggggggggggggggggggg/org.hypercerts.claim.activity/3jzfcijpj2z2j';
const absentSubjectUri = 'at://did:plc:gggggggggggggggggggggggg/org.hypercerts.claim.activity/3jzfcijpj2z2k';
const subjectCid = 'bafyreih2gywmzfterjcd3egdsheuloawhwykojkrxb2tnfsjjuou5nu5va';

async function callEndpoint(nsid, params = {}) {
  const url = contractUrl(requireContractTarget(), nsid, params);
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body };
}

const getMeasurement = (uri) => callEndpoint(endpoint, { uri });
const listMeasurements = (params) => callEndpoint(listEndpoint, params);

test('getMeasurement returns the exact indexed record and hydrates both publisher sidecars', async () => {
  const { response, body } = await getMeasurement(measurementUri);
  assert.equal(response.status, 200, JSON.stringify(body));

  const { measurement } = body;
  assert.equal(measurement.uri, measurementUri);
  assert.equal(measurement.cid, 'bafyreihu2rszmv7k3uhufix4rh2ksbuq7pddhaic7jn6g2s6lbur3dl254');
  assert.equal(measurement.indexedAt, '2025-03-01T00:00:00.000Z');
  assert.equal(measurement.did, publisher);
  assert.deepEqual(measurement.record, {
    $type: collection,
    metric: 'trees planted',
    unit: 'tree',
    value: '00012.3400',
    createdAt: '2025-02-01T00:00:00.000Z',
    subjects: [{ uri: subjectUri, cid: subjectCid }],
    measurers: [{ did: 'did:plc:oooooooooooooooooooooooo' }],
  });
  assert.equal(measurement.author.did, publisher);
  assert.equal(measurement.author.profile.record.displayName, 'Measurement Publisher');
  assert.deepEqual(measurement.author.organization.record.organizationType, ['nonprofit']);
});

test('listMeasurements applies repeated author and subject filters and excludes nonmatches', async () => {
  const { response, body } = await listMeasurements({
    authors: [publisher, publisherB],
    subjects: [subjectUri, otherSubjectUri],
    sortDirection: 'asc',
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.measurements.map(({ uri }) => uri), [measurementUris.a, measurementUris.b, measurementUris.d]);
  assert.equal(body.measurements[0].record.metric, 'trees planted');
  assert.equal(body.measurements[2].author.profile, null);
  assert.equal(body.measurements[2].author.organization, null);

  const byMeasurerOnly = await listMeasurements({ authors: [measurer] });
  assert.equal(byMeasurerOnly.response.status, 200, JSON.stringify(byMeasurerOnly.body));
  assert.deepEqual(byMeasurerOnly.body.measurements, []);

  const byAbsentSubject = await listMeasurements({ subjects: [absentSubjectUri] });
  assert.equal(byAbsentSubject.response.status, 200, JSON.stringify(byAbsentSubject.body));
  assert.deepEqual(byAbsentSubject.body.measurements, []);
});

test('listMeasurements paginates timestamp ties by URI in both directions', async () => {
  for (const [sortDirection, firstPage, secondPage] of [
    ['asc', [measurementUris.a, measurementUris.b], [measurementUris.c, measurementUris.d]],
    ['desc', [measurementUris.d, measurementUris.c], [measurementUris.b, measurementUris.a]],
  ]) {
    const first = await listMeasurements({ sortDirection, limit: 2 });
    assert.equal(first.response.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.measurements.map(({ uri }) => uri), firstPage);
    assert.deepEqual(first.body.measurements.map(({ record }) => record.createdAt), sortDirection === 'asc'
      ? ['2025-02-01T00:00:00.000Z', '2025-02-01T00:00:00.000Z']
      : ['2025-02-02T00:00:00.000Z', '2025-02-01T00:00:00.000Z']);
    assert.equal(typeof first.body.cursor, 'string');

    const second = await listMeasurements({ sortDirection, limit: 2, cursor: first.body.cursor });
    assert.equal(second.response.status, 200, JSON.stringify(second.body));
    assert.deepEqual(second.body.measurements.map(({ uri }) => uri), secondPage);
    assert.equal(Object.hasOwn(second.body, 'cursor'), false);
    const collected = [...firstPage, ...secondPage];
    assert.equal(new Set(collected).size, 4);
    assert.deepEqual(collected, sortDirection === 'asc'
      ? [measurementUris.a, measurementUris.b, measurementUris.c, measurementUris.d]
      : [measurementUris.d, measurementUris.c, measurementUris.b, measurementUris.a]);
  }
});

test('getMeasurement returns null when the publisher has no sidecar records', async () => {
  const { response, body } = await getMeasurement(measurementUris.d);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.measurement.author.profile, null);
  assert.equal(body.measurement.author.organization, null);
});

function assertLuaRuntimeError({ response, body }, method, errorName) {
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, method);
  assert.match(body.message, new RegExp(errorName));
}

test('getMeasurement returns the named RecordNotFound runtime error for an unindexed URI', async () => {
  const result = await getMeasurement(`at://${publisher}/${collection}/3jzfcijpj2z2z`);
  assertLuaRuntimeError(result, endpoint, 'RecordNotFound');
});

test('getMeasurement returns the named InvalidRequest runtime error for a wrong collection', async () => {
  const result = await getMeasurement(`at://${publisher}/org.hypercerts.context.evaluation/3jzfcijpj2z2z`);
  assertLuaRuntimeError(result, endpoint, 'InvalidRequest');
});

test('listMeasurements returns the named InvalidRequest runtime error for an oversized limit', async () => {
  const result = await listMeasurements({ limit: 101 });
  assertLuaRuntimeError(result, listEndpoint, 'InvalidRequest');
});
