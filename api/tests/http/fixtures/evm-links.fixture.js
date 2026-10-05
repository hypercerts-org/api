import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const collection = 'app.certified.link.evm';
const profileCollection = 'app.certified.actor.profile';
const primaryDid = 'did:web:evm-links-primary.invalid';
const secondaryDid = 'did:web:evm-links-secondary.invalid';
const outsideDid = 'did:web:evm-links-outside.invalid';
const indexedAt = '2025-03-01T12:00:00.000Z';
const tiedCreatedAt = '2025-02-01T00:00:00.000Z';

const linkSpecs = [
  {
    did: primaryDid,
    rkey: 'wallet-a',
    address: '0xAa00000000000000000000000000000000000001',
    createdAt: tiedCreatedAt,
    nonce: '1',
  },
  {
    did: primaryDid,
    rkey: 'wallet-b',
    address: '0xBb00000000000000000000000000000000000002',
    createdAt: tiedCreatedAt,
    nonce: '2',
  },
  {
    did: secondaryDid,
    rkey: 'wallet-c',
    address: '0xAa00000000000000000000000000000000000001',
    createdAt: tiedCreatedAt,
    nonce: '3',
  },
  {
    did: secondaryDid,
    rkey: 'wallet-d',
    address: '0xCc00000000000000000000000000000000000003',
    createdAt: tiedCreatedAt,
    nonce: '4',
  },
  {
    did: outsideDid,
    rkey: 'wallet-e',
    address: '0xBb00000000000000000000000000000000000002',
    createdAt: tiedCreatedAt,
    nonce: '5',
  },
  {
    did: outsideDid,
    rkey: 'wallet-f',
    address: '0xCc00000000000000000000000000000000000003',
    createdAt: '2025-02-02T00:00:00.000Z',
    nonce: '6',
  },
];

async function makeSeedRow(did, targetCollection, rkey, fields) {
  const record = { $type: targetCollection, ...fields };
  const uri = `at://${did}/${targetCollection}/${rkey}`;
  return {
    uri,
    did,
    collection: targetCollection,
    rkey,
    cid: CID.toString(await CID.create(0x71, encode(record))),
    indexedAt,
    record,
  };
}

export const seedRows = await Promise.all([
  ...linkSpecs.map(({ did, rkey, address, createdAt, nonce }) => makeSeedRow(did, collection, rkey, {
    address,
    proof: {
      $type: `${collection}#eip712Proof`,
      signature: `0x${nonce.repeat(128)}`,
      message: {
        $type: `${collection}#eip712Message`,
        did,
        evmAddress: address,
        chainId: '1',
        timestamp: '1738368000',
        nonce,
      },
    },
    createdAt,
  })),
  makeSeedRow(primaryDid, profileCollection, 'self', {
    displayName: 'EVM Link Primary Actor',
    description: 'Hydration fixture for the EVM-link query.',
    createdAt: indexedAt,
  }),
]);
