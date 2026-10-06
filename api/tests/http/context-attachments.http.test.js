import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';

const endpoint = 'org.hypercerts.context.getAttachment';
const publisher = 'did:web:context-attachment-a.invalid';
const attachmentUri = `at://${publisher}/org.hypercerts.context.attachment/3jzfcijpj2z2a`;

async function request(endpointName, params = {}) {
  const url = contractUrl(requireContractTarget(), endpointName, params);
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

test('getAttachment returns its CBOR-addressed record and hydrated publisher sidecars', async () => {
  const { response, body } = await request(endpoint, { uri: attachmentUri });
  assert.equal(response.status, 200, JSON.stringify(body));

  const { attachment } = body;
  assert.equal(attachment.uri, attachmentUri);
  assert.equal(attachment.cid, 'bafyreiegk6g6h77f36xiwpegy62bb75gh2ayw5ddqc6pu3vocixyhouogq');
  assert.equal(attachment.indexedAt, '2025-03-04T05:06:07.000Z');
  assert.equal(attachment.did, publisher);
  assert.equal(attachment.record.$type, 'org.hypercerts.context.attachment');
  assert.equal(attachment.record.title, 'Evidence attachment A');
  assert.deepEqual(attachment.record.subjects, [{
    uri: 'at://did:web:context-subject-a.invalid/org.hypercerts.claim.activity/subject-a',
    cid: 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  }]);
  assert.equal(attachment.record.content[0].uri, 'https://example.test/context/a.pdf');
  assert.equal(attachment.author.did, publisher);
  assert.equal(attachment.author.profile.record.displayName, 'Context attachment publisher');
  assert.equal(attachment.author.organization, null);
});

test('getAttachment exposes RecordNotFound and InvalidRequest through the pinned runtime error response', async () => {
  const missing = await request(endpoint, {
    uri: `at://${publisher}/org.hypercerts.context.attachment/not-indexed`,
  });
  assert.equal(missing.response.status, 500, JSON.stringify(missing.body));
  assert.equal(missing.body.error, 'script_error');
  assert.equal(missing.body.errorType, 'runtime');
  assert.equal(missing.body.method, endpoint);
  assert.match(missing.body.message, /RecordNotFound/);

  const invalid = await request(endpoint, {
    uri: `at://${publisher}/org.hypercerts.claim.activity/not-an-attachment`,
  });
  assert.equal(invalid.response.status, 500, JSON.stringify(invalid.body));
  assert.equal(invalid.body.error, 'script_error');
  assert.equal(invalid.body.errorType, 'runtime');
  assert.equal(invalid.body.method, endpoint);
  assert.match(invalid.body.message, /InvalidRequest/);
});

test('listAttachments applies each filter and ANDs distinct filters', async () => {
  const listEndpoint = 'org.hypercerts.context.listAttachments';
  const uris = {
    a: `at://${publisher}/org.hypercerts.context.attachment/3jzfcijpj2z2a`,
    b: `at://${publisher}/org.hypercerts.context.attachment/3jzfcijpj2z2b`,
    c: 'at://did:web:context-attachment-b.invalid/org.hypercerts.context.attachment/3jzfcijpj2z2c',
    d: 'at://did:web:context-attachment-c.invalid/org.hypercerts.context.attachment/3jzfcijpj2z2d',
  };
  const subjectA = 'at://did:web:context-subject-a.invalid/org.hypercerts.claim.activity/subject-a';

  for (const [params, expectedUris] of [
    [{ authors: [publisher] }, [uris.a, uris.b]],
    [{ authors: [publisher, 'did:web:context-attachment-b.invalid'] }, [uris.a, uris.b, uris.c]],
    [{ uris: [uris.b] }, [uris.b]],
    [{ subjects: [subjectA] }, [uris.a]],
    [{ contentTypes: ['evidence'] }, [uris.a, uris.c]],
    [{
      authors: [publisher, 'did:web:context-attachment-b.invalid'],
      subjects: [subjectA],
      contentTypes: ['evidence'],
    }, [uris.a]],
  ]) {
    const { response, body } = await request(listEndpoint, { ...params, sortDirection: 'asc' });
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.deepEqual(body.attachments.map(({ uri }) => uri), expectedUris);
  }
});

test('listAttachments paginates the complete feed across tied createdAt timestamps', async () => {
  const listEndpoint = 'org.hypercerts.context.listAttachments';
  const expected = [
    `at://${publisher}/org.hypercerts.context.attachment/3jzfcijpj2z2a`,
    `at://${publisher}/org.hypercerts.context.attachment/3jzfcijpj2z2b`,
    'at://did:web:context-attachment-b.invalid/org.hypercerts.context.attachment/3jzfcijpj2z2c',
    'at://did:web:context-attachment-c.invalid/org.hypercerts.context.attachment/3jzfcijpj2z2d',
  ];
  const first = await request(listEndpoint, { sortDirection: 'asc', limit: 2 });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.attachments.map(({ uri }) => uri), expected.slice(0, 2));
  assert.equal(typeof first.body.cursor, 'string');

  const second = await request(listEndpoint, {
    sortDirection: 'asc', limit: 2, cursor: first.body.cursor,
  });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(second.body.attachments.map(({ uri }) => uri), expected.slice(2));
  assert.equal(Object.hasOwn(second.body, 'cursor'), false);
});

test('listAttachments exposes InvalidRequest through the pinned runtime error response', async () => {
  const listEndpoint = 'org.hypercerts.context.listAttachments';
  const { response, body } = await request(listEndpoint, { limit: 101 });
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, listEndpoint);
  assert.match(body.message, /InvalidRequest/);
});
