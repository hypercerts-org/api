import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';
import { locationRecords } from '../../fixtures/records.js';

const collection = 'org.hypercerts.funding.receipt';
const publisher = 'did:plc:abcdefghijklmnopqrstuvwx';
const otherPublisher = 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb';
const sender = 'did:plc:cccccccccccccccccccccccc';
const otherSender = 'did:plc:dddddddddddddddddddddddd';
const recipient = 'did:plc:eeeeeeeeeeeeeeeeeeeeeeee';
const target = 'at://did:plc:ffffffffffffffffffffffff/org.hypercerts.claim.activity/target';
const otherTarget = 'at://did:plc:ffffffffffffffffffffffff/org.hypercerts.claim.activity/other-target';
const senderRecord = 'at://did:plc:111111111111111111111111/org.hypercerts.claim.activity/sender';
const recipientRecord = 'at://did:plc:222222222222222222222222/org.hypercerts.claim.activity/recipient';
const strongRefCid = locationRecords[0].cid;
const indexedAt = '2025-02-01T00:00:00.000Z';

const receiptSpecs = [
  {
    did: publisher,
    rkey: 'receipt-a',
    record: {
      from: { $type: 'app.certified.defs#did', did: sender },
      to: { $type: 'app.certified.defs#did', did: recipient },
      for: { $type: 'com.atproto.repo.strongRef', uri: target, cid: strongRefCid },
      amount: '0012345678901234567890.00000001',
      currency: 'USD',
      paymentRail: 'bank_transfer',
      transactionId: 'Tx-CaseSensitive',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  },
  {
    did: publisher,
    rkey: 'receipt-b',
    record: {
      from: { $type: 'com.atproto.repo.strongRef', uri: senderRecord, cid: strongRefCid },
      to: { $type: 'com.atproto.repo.strongRef', uri: recipientRecord, cid: strongRefCid },
      for: { $type: 'com.atproto.repo.strongRef', uri: target, cid: strongRefCid },
      amount: '2.50',
      currency: 'USD',
      paymentRail: 'onchain',
      paymentNetwork: 'ethereum',
      transactionId: 'Tx-CaseSensitive',
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  },
  {
    did: otherPublisher,
    rkey: 'receipt-c',
    record: {
      from: { $type: 'app.certified.defs#did', did: sender },
      to: { $type: 'app.certified.defs#did', did: recipient },
      for: { $type: 'com.atproto.repo.strongRef', uri: target, cid: strongRefCid },
      amount: '3',
      currency: 'USD',
      transactionId: 'Tx-CaseSensitive',
      createdAt: '2025-01-02T00:00:00.000Z',
    },
  },
  {
    did: otherPublisher,
    rkey: 'receipt-d',
    record: {
      from: { $type: 'app.certified.defs#did', did: otherSender },
      to: { $type: 'app.certified.defs#did', did: recipient },
      for: { $type: 'com.atproto.repo.strongRef', uri: target, cid: strongRefCid },
      amount: '4',
      currency: 'USD',
      transactionId: 'Tx-CaseSensitive',
      createdAt: '2025-01-03T00:00:00.000Z',
    },
  },
  {
    did: otherPublisher,
    rkey: 'receipt-e',
    record: {
      from: { $type: 'app.certified.defs#did', did: sender },
      to: { $type: 'app.certified.defs#did', did: recipient },
      for: { $type: 'com.atproto.repo.strongRef', uri: otherTarget, cid: strongRefCid },
      amount: '5',
      currency: 'USD',
      transactionId: 'Tx-CaseSensitive',
      createdAt: '2025-01-04T00:00:00.000Z',
    },
  },
  {
    did: otherPublisher,
    rkey: 'receipt-f',
    record: {
      from: { $type: 'app.certified.defs#did', did: sender },
      to: { $type: 'app.certified.defs#did', did: recipient },
      for: { $type: 'com.atproto.repo.strongRef', uri: target, cid: strongRefCid },
      amount: '6',
      currency: 'USD',
      transactionId: 'tx-other',
      createdAt: '2025-01-05T00:00:00.000Z',
    },
  },
];

export const seedRows = await Promise.all(receiptSpecs.map(async ({ did, rkey, record }) => {
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
