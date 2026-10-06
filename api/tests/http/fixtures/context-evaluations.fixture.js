import { encode } from '@atcute/cbor';
import * as CID from '@atcute/cid';

const evaluationCollection = 'org.hypercerts.context.evaluation';
const profileCollection = 'app.certified.actor.profile';
const organizationCollection = 'app.certified.actor.organization';
const authorA = 'did:web:context-evaluation-a.invalid';
const authorB = 'did:web:context-evaluation-b.invalid';
const evaluatorA = 'did:web:context-evaluator-a.invalid';
const evaluatorB = 'did:web:context-evaluator-b.invalid';
const evaluatorC = 'did:web:context-evaluator-c.invalid';
const subjectA = 'at://did:web:context-eval-subject-a.invalid/org.hypercerts.claim.activity/subject-a';
const subjectB = 'at://did:web:context-eval-subject-b.invalid/org.hypercerts.claim.activity/subject-b';
const subjectC = 'at://did:web:context-eval-subject-c.invalid/org.hypercerts.claim.activity/subject-c';
const subjectCid = 'bafyreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const indexedAt = '2025-03-04T05:06:07.000Z';
const tiedCreatedAt = '2025-03-01T00:00:00.000Z';

const evaluationSpecs = [
  {
    did: authorA,
    rkey: '3jzfcijpj2z2a',
    record: {
      evaluators: [{ did: evaluatorA }, { did: evaluatorA }, { did: evaluatorB }],
      summary: 'Evaluation A',
      createdAt: tiedCreatedAt,
      subject: { uri: subjectA, cid: subjectCid },
      score: { min: '0', max: '5', value: '4.5' },
    },
  },
  {
    did: authorA,
    rkey: '3jzfcijpj2z2b',
    record: {
      evaluators: [{ did: evaluatorB }],
      summary: 'Evaluation B',
      createdAt: tiedCreatedAt,
      subject: { uri: subjectB, cid: subjectCid },
      score: { min: '0', max: '5', value: '3' },
    },
  },
  {
    did: authorB,
    rkey: '3jzfcijpj2z2c',
    record: {
      evaluators: [{ did: evaluatorB }],
      summary: 'Evaluation C',
      createdAt: tiedCreatedAt,
      subject: { uri: subjectA, cid: subjectCid },
      score: { min: '0', max: '5', value: '2' },
    },
  },
  {
    did: authorB,
    rkey: '3jzfcijpj2z2d',
    record: {
      evaluators: [{ did: evaluatorC }],
      summary: 'Evaluation D',
      createdAt: '2025-03-02T00:00:00.000Z',
      subject: { uri: subjectC, cid: subjectCid },
      score: { min: '0', max: '5', value: '1' },
    },
  },
];

async function seedRow(collection, did, rkey, fields) {
  const record = { $type: collection, ...fields };
  return {
    uri: `at://${did}/${collection}/${rkey}`,
    did,
    collection,
    rkey,
    cid: CID.toString(await CID.create(0x71, encode(record))),
    indexedAt,
    record,
  };
}

export const seedRows = await Promise.all([
  ...evaluationSpecs.map(({ did, rkey, record }) => seedRow(evaluationCollection, did, rkey, record)),
  seedRow(profileCollection, authorA, 'self', {
    displayName: 'Context evaluation publisher',
    createdAt: indexedAt,
  }),
  seedRow(profileCollection, evaluatorA, 'self', {
    displayName: 'Named context evaluator',
    createdAt: indexedAt,
  }),
  seedRow(organizationCollection, authorB, 'self', {
    organizationType: ['nonprofit'],
    visibility: 'public',
    createdAt: indexedAt,
  }),
]);
