import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const collection = 'org.hypercerts.claim.rights';
const indexedAt = '2025-02-03T04:06:00.000Z';
const createdAt = '2025-02-01T00:00:00.000Z';

const rightsSpecs = [
  {
    did: 'did:web:rights-alpha.example',
    rkey: '3jzfcijpj2z2a',
    record: {
      rightsName: 'All Rights Reserved',
      rightsType: 'ARR',
      rightsDescription: 'Permission terms are retained in full.',
      createdAt,
    },
  },
  {
    did: 'did:web:rights-alpha.example',
    rkey: '3jzfcijpj2z2b',
    record: {
      rightsName: 'Attribution Rights',
      rightsType: 'ARR',
      rightsDescription: 'Attribution is required when reusing this work.',
      createdAt,
    },
  },
  {
    did: 'did:web:rights-bravo.example',
    rkey: '3jzfcijpj2z2c',
    record: {
      rightsName: 'Community Use',
      rightsType: 'ARR',
      rightsDescription: 'Community use is permitted under these terms.',
      createdAt,
    },
  },
  {
    did: 'did:web:rights-charlie.example',
    rkey: '3jzfcijpj2z2d',
    record: {
      rightsName: 'Research Use',
      rightsType: 'ARR',
      rightsDescription: 'Research use is permitted under these terms.',
      createdAt,
    },
  },
  {
    did: 'did:web:rights-outsider.example',
    rkey: '3jzfcijpj2z2e',
    record: {
      rightsName: 'Outside Filter',
      rightsType: 'ARR',
      rightsDescription: 'This record distinguishes author filtering.',
      createdAt,
    },
  },
];

export const seedRows = await Promise.all(rightsSpecs.map(async ({ did, rkey, record }) => {
  const storedRecord = { $type: collection, ...record };
  return {
    uri: `at://${did}/${collection}/${rkey}`,
    did,
    collection,
    rkey,
    cid: CID.toString(await CID.create(0x71, encode(storedRecord))),
    indexedAt,
    record: storedRecord,
  };
}));
