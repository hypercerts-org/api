import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';
import { graphDids } from './fixtures/graph-follows.fixture.js';

const endpoint = 'app.certified.graph.getFollow';
const baseUrl = requireContractTarget();

async function getFollow(actor, subject) {
  const response = await fetch(contractUrl(baseUrl, endpoint, { actor, subject }), {
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

test('getFollow returns the earliest tied record with its independently expected CID', async () => {
  const { response, body } = await getFollow(graphDids.publisher, graphDids.primarySubject);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body, {
    follow: {
      uri: `at://${graphDids.publisher}/app.certified.graph.follow/3jzfcijpj2z2a`,
      cid: 'bafyreibvbi6wq6v4ra4ktrkvup36euf5exfxice57zojxcf5g7dqrswwie',
      indexedAt: '2025-03-01T00:00:00.000Z',
      did: graphDids.publisher,
      record: {
        $type: 'app.certified.graph.follow',
        subject: graphDids.primarySubject,
        createdAt: '2025-02-10T00:00:00.000Z',
        via: {
          uri: `at://${graphDids.curator}/app.certified.graph.list/3jzfcijpj2z2a`,
          cid: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
        },
      },
    },
  });
});

test('getFollow returns explicit null when the actor-subject pair is not indexed', async () => {
  const { response, body } = await getFollow(graphDids.publisher, graphDids.thirdFollower);

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body, { follow: null });
});
