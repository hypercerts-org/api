import test from 'node:test';
import assert from 'node:assert/strict';
import { contractUrl, requireContractTarget } from './helpers.js';
import { seedRows } from './fixtures/evm-links.fixture.js';

const getEndpoint = 'app.certified.link.getEvmLink';
const listEndpoint = 'app.certified.link.listEvmLinks';
const primaryDid = 'did:web:evm-links-primary.invalid';
const secondaryDid = 'did:web:evm-links-secondary.invalid';
const outsideDid = 'did:web:evm-links-outside.invalid';
const primaryUri = `at://${primaryDid}/app.certified.link.evm/wallet-a`;
const addressA = '0xAa00000000000000000000000000000000000001';
const addressB = '0xBb00000000000000000000000000000000000002';
const linkUris = {
  outsideTie: `at://${outsideDid}/app.certified.link.evm/wallet-e`,
  primaryA: primaryUri,
  primaryB: `at://${primaryDid}/app.certified.link.evm/wallet-b`,
  secondaryC: `at://${secondaryDid}/app.certified.link.evm/wallet-c`,
  secondaryD: `at://${secondaryDid}/app.certified.link.evm/wallet-d`,
  outsideLater: `at://${outsideDid}/app.certified.link.evm/wallet-f`,
};

async function requestEvmLink(endpoint, params = {}) {
  const url = contractUrl(requireContractTarget(), endpoint, params);
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

function assertRuntimeError({ response, body }, endpoint, errorName) {
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, 'script_error');
  assert.equal(body.errorType, 'runtime');
  assert.equal(body.method, endpoint);
  assert.match(body.message, new RegExp(errorName));
}

test('getEvmLink returns the indexed record with its original CID and hydrated nullable sidecars', async () => {
  const { response, body } = await requestEvmLink(getEndpoint, { uri: primaryUri });
  assert.equal(response.status, 200, JSON.stringify(body));

  const { evmLink } = body;
  assert.equal(evmLink.uri, primaryUri);
  assert.equal(evmLink.cid, 'bafyreihg3evnlzsrtyctc7azoz6qcfngdglqmcimmxl6nqr2abf25c5ggy');
  assert.equal(evmLink.indexedAt, '2025-03-01T12:00:00.000Z');
  assert.equal(evmLink.did, primaryDid);
  assert.deepEqual(evmLink.record, seedRows[0].record);
  assert.equal(evmLink.actor.did, primaryDid);
  assert.equal(evmLink.actor.profile.uri, `at://${primaryDid}/app.certified.actor.profile/self`);
  assert.equal(evmLink.actor.profile.record.displayName, 'EVM Link Primary Actor');
  assert.equal(evmLink.actor.organization, null);
});

test('getEvmLink exposes InvalidRequest for a URI in another collection', async () => {
  const result = await requestEvmLink(getEndpoint, {
    uri: `at://${primaryDid}/app.certified.badge.definition/wallet-a`,
  });
  assertRuntimeError(result, getEndpoint, 'InvalidRequest');
});

test('getEvmLink exposes RecordNotFound for an unindexed EVM-link URI', async () => {
  const result = await requestEvmLink(getEndpoint, {
    uri: `at://${primaryDid}/app.certified.link.evm/not-indexed`,
  });
  assertRuntimeError(result, getEndpoint, 'RecordNotFound');
});

test('listEvmLinks ORs repeated actor and normalized address filters, then intersects them', async () => {
  const { response, body } = await requestEvmLink(listEndpoint, {
    actors: [primaryDid, secondaryDid],
    addresses: [addressA.toLowerCase(), `0x${addressB.slice(2).toUpperCase()}`],
    sortDirection: 'asc',
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(body.evmLinks.map(({ uri }) => uri), [
    linkUris.primaryA,
    linkUris.primaryB,
    linkUris.secondaryC,
  ]);
  assert.equal(body.evmLinks[0].record.address, addressA, 'matching must not rewrite the stored address');
  assert.equal(body.evmLinks[1].record.address, addressB);
  assert.equal(body.evmLinks[0].actor.profile.record.displayName, 'EVM Link Primary Actor');
  assert.equal(body.evmLinks[0].actor.organization, null);
  assert.equal(body.evmLinks[2].actor.profile, null);
  assert.equal(body.evmLinks[2].actor.organization, null);
  assert.equal(Object.hasOwn(body, 'cursor'), false);
});

test('listEvmLinks paginates tied timestamps in both sort directions without repeats or omissions', async () => {
  const directions = [
    {
      direction: 'asc',
      expectedPages: [
        [linkUris.outsideTie, linkUris.primaryA],
        [linkUris.primaryB, linkUris.secondaryC],
        [linkUris.secondaryD, linkUris.outsideLater],
      ],
    },
    {
      direction: 'desc',
      expectedPages: [
        [linkUris.outsideLater, linkUris.secondaryD],
        [linkUris.secondaryC, linkUris.primaryB],
        [linkUris.primaryA, linkUris.outsideTie],
      ],
    },
  ];

  for (const { direction, expectedPages } of directions) {
    let cursor;
    let pageIndex = 0;
    do {
      const { response, body } = await requestEvmLink(listEndpoint, {
        sortDirection: direction,
        limit: 2,
        cursor,
      });
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.deepEqual(body.evmLinks.map(({ uri }) => uri), expectedPages[pageIndex]);
      assert.equal(typeof body.cursor, pageIndex < expectedPages.length - 1 ? 'string' : 'undefined');
      cursor = body.cursor;
      pageIndex += 1;
      assert.ok(pageIndex <= expectedPages.length, 'pagination must terminate after the fixture rows');
    } while (cursor !== undefined);
    assert.equal(pageIndex, expectedPages.length);
  }
});

test('listEvmLinks exposes InvalidRequest for a malformed EVM address filter', async () => {
  const result = await requestEvmLink(listEndpoint, { addresses: 'not-an-address' });
  assertRuntimeError(result, listEndpoint, 'InvalidRequest');
});
