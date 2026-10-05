import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const publisher = 'did:plc:llllllllllllllllllllllll';
const secondPublisher = 'did:plc:oooooooooooooooooooooooo';
const thirdPublisher = 'did:plc:pppppppppppppppppppppppp';
const subjectUri = 'at://did:plc:mmmmmmmmmmmmmmmmmmmmmmmm/org.hypercerts.claim.activity/ack-subject';
const secondSubjectUri = 'at://did:plc:nnnnnnnnnnnnnnnnnnnnnnnn/org.hypercerts.claim.activity/ack-subject-two';
const thirdSubjectUri = 'at://did:plc:qqqqqqqqqqqqqqqqqqqqqqqq/org.hypercerts.claim.activity/ack-subject-three';
const acknowledgementCollection = 'org.hypercerts.context.acknowledgement';
const getMethod = 'org.hypercerts.context.getAcknowledgement';
const listMethod = 'org.hypercerts.context.listAcknowledgements';
const uris = {
  one: 'at://did:plc:llllllllllllllllllllllll/org.hypercerts.context.acknowledgement/ack-one',
  middleA: 'at://did:plc:llllllllllllllllllllllll/org.hypercerts.context.acknowledgement/ack-middle-a',
  middleB: 'at://did:plc:oooooooooooooooooooooooo/org.hypercerts.context.acknowledgement/ack-middle-b',
  late: 'at://did:plc:oooooooooooooooooooooooo/org.hypercerts.context.acknowledgement/ack-late',
  authorNegative: 'at://did:plc:pppppppppppppppppppppppp/org.hypercerts.context.acknowledgement/ack-author-negative',
  subjectNegative: 'at://did:plc:llllllllllllllllllllllll/org.hypercerts.context.acknowledgement/ack-subject-negative',
};

async function query(method, params = {}) {
  const url = contractUrl(requireContractTarget(), method, params);
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

test('getAcknowledgement returns the indexed record and hydrates its publisher sidecars', async () => {
  const { response, body } = await query(getMethod, { uri: uris.one });
  assert.equal(response.status, 200, JSON.stringify(body));

  const { acknowledgement } = body;
  assert.equal(acknowledgement.uri, uris.one);
  assert.equal(acknowledgement.did, publisher);
  assert.equal(acknowledgement.cid, 'bafyreicaptuxchi7dtggnde6r44fgeh5gs4ynqp3iydlman62zifbuo5dy');
  assert.equal(acknowledgement.indexedAt, '2025-03-04T05:06:07.000Z');
  assert.deepEqual(acknowledgement.record, {
    $type: acknowledgementCollection,
    acknowledged: true,
    comment: 'The subject is supported.',
    subject: {
      uri: subjectUri,
      cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    context: {
      uri: 'at://did:plc:rrrrrrrrrrrrrrrrrrrrrrrr/org.hypercerts.collection/ack-context',
      cid: 'bafyreibbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    createdAt: '2025-03-03T00:00:00.000Z',
  });
  assert.equal(acknowledgement.author.did, publisher);
  assert.equal(acknowledgement.author.profile.uri, `at://${publisher}/app.certified.actor.profile/self`);
  assert.equal(acknowledgement.author.profile.record.displayName, 'Acknowledgement Publisher');
  assert.equal(acknowledgement.author.organization.uri, `at://${publisher}/app.certified.actor.organization/self`);
  assert.deepEqual(acknowledgement.author.organization.record.organizationType, ['nonprofit']);
});

test('getAcknowledgement reports a missing record as a named pinned-runtime error', async () => {
  const missingUri = 'at://did:plc:llllllllllllllllllllllll/org.hypercerts.context.acknowledgement/not-indexed';
  const { response, body } = await query(getMethod, { uri: missingUri });
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, getMethod);
  assert.match(body.message, /RecordNotFound/);
});

test('getAcknowledgement reports an invalid URI as a named pinned-runtime error', async () => {
  const { response, body } = await query(getMethod, {
    uri: 'at://alice.example/org.hypercerts.context.acknowledgement/ack-one',
  });
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, getMethod);
  assert.match(body.message, /InvalidRequest/);
});

test('listAcknowledgements returns the full default feed in descending timestamp-and-URI order', async () => {
  const { response, body } = await query(listMethod);
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.acknowledgements.map(({ uri }) => uri), [
    uris.subjectNegative,
    uris.authorNegative,
    uris.late,
    uris.middleB,
    uris.middleA,
    uris.one,
  ]);
  assert.equal(body.cursor, undefined);
});

test('listAcknowledgements combines repeated OR filters with AND and rejects filter false positives', async () => {
  const { response, body } = await query(listMethod, {
    authors: [publisher, secondPublisher],
    subjects: [subjectUri, secondSubjectUri],
    sortDirection: 'asc',
    limit: '10',
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.acknowledgements.map(({ uri }) => uri), [
    uris.one,
    uris.middleA,
    uris.middleB,
    uris.late,
  ]);

  const negative = await query(listMethod, {
    authors: [thirdPublisher],
    subjects: [thirdSubjectUri],
  });
  assert.equal(negative.response.status, 200, JSON.stringify(negative.body));
  assert.deepEqual(negative.body.acknowledgements, []);
  assert.equal(negative.body.cursor, undefined);
});

test('listAcknowledgements advances in both directions across equal-timestamp URI ties', async () => {
  const expected = {
    asc: [uris.one, uris.middleA, uris.middleB, uris.late, uris.authorNegative, uris.subjectNegative],
    desc: [uris.subjectNegative, uris.authorNegative, uris.late, uris.middleB, uris.middleA, uris.one],
  };

  for (const direction of ['asc', 'desc']) {
    const actual = [];
    let cursor;
    for (let page = 0; page < expected[direction].length + 1; page += 1) {
      const result = await query(listMethod, {
        sortDirection: direction,
        limit: '1',
        ...(cursor ? { cursor } : {}),
      });
      assert.equal(result.response.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.acknowledgements.length, 1);
      actual.push(result.body.acknowledgements[0].uri);
      cursor = result.body.cursor;
      if (!cursor) break;
    }
    assert.deepEqual(actual, expected[direction]);
  }
});

test('getAcknowledgement serializes absent publisher sidecars as null', async () => {
  const { response, body } = await query(getMethod, { uri: uris.middleB });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.acknowledgement.author.did, secondPublisher);
  assert.equal(body.acknowledgement.author.profile, null);
  assert.equal(body.acknowledgement.author.organization, null);
});

test('listAcknowledgements reports invalid bounds as a named pinned-runtime error', async () => {
  const { response, body } = await query(listMethod, { limit: '0' });
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, listMethod);
  assert.match(body.message, /InvalidRequest/);
});
