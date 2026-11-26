import assert from "node:assert/strict";
import test from "node:test";
import { contractUrl, requireContractTarget } from "./helpers.js";

const endpoint = "org.hypercerts.funding.listReceipts";
const publisherA = "did:web:funding-http-publisher.invalid";
const publisherB = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb";
const sender = "did:plc:cccccccccccccccccccccccc";
const recipient = "did:plc:eeeeeeeeeeeeeeeeeeeeeeee";
const target = "at://did:plc:ffffffffffffffffffffffff/org.hypercerts.claim.activity/target";
const senderRecord = "at://did:plc:111111111111111111111111/org.hypercerts.claim.activity/sender";
const recipientRecord =
  "at://did:plc:222222222222222222222222/org.hypercerts.claim.activity/recipient";
const receiptUris = {
  a: `at://${publisherA}/org.hypercerts.funding.receipt/receipt-a`,
  b: `at://${publisherA}/org.hypercerts.funding.receipt/receipt-b`,
  c: `at://${publisherB}/org.hypercerts.funding.receipt/receipt-c`,
  d: `at://${publisherB}/org.hypercerts.funding.receipt/receipt-d`,
  e: `at://${publisherB}/org.hypercerts.funding.receipt/receipt-e`,
  f: `at://${publisherB}/org.hypercerts.funding.receipt/receipt-f`,
};

async function listReceipts(params) {
  const url = contractUrl(requireContractTarget(), endpoint, params);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
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

test("listReceipts applies OR within repeated filters and AND between filters against indexed rows", async () => {
  const { response, body } = await listReceipts({
    authors: [publisherA, publisherB],
    from: [sender, senderRecord],
    to: [recipient, recipientRecord],
    forUris: [target],
    transactionIds: ["Tx-CaseSensitive"],
    sortDirection: "asc",
  });

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(
    body.receipts.map(({ uri }) => uri),
    [receiptUris.a, receiptUris.b, receiptUris.c],
  );
  assert.equal(body.receipts[0].record.amount, "0012345678901234567890.00000001");
  assert.equal(body.receipts[1].record.from.uri, senderRecord);
  assert.equal(body.receipts[2].did, publisherB);
});

test("listReceipts paginates stable createdAt and URI order without repeating or omitting rows", async () => {
  const first = await listReceipts({ sortDirection: "asc", limit: 2 });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.deepEqual(
    first.body.receipts.map(({ uri }) => uri),
    [receiptUris.a, receiptUris.b],
  );
  assert.equal(typeof first.body.cursor, "string");
  assert.ok(first.body.cursor.length > 0);

  const second = await listReceipts({ sortDirection: "asc", limit: 2, cursor: first.body.cursor });
  assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.deepEqual(
    second.body.receipts.map(({ uri }) => uri),
    [receiptUris.c, receiptUris.d],
  );
  assert.equal(typeof second.body.cursor, "string");

  const third = await listReceipts({ sortDirection: "asc", limit: 2, cursor: second.body.cursor });
  assert.equal(third.response.status, 200, JSON.stringify(third.body));
  assert.deepEqual(
    third.body.receipts.map(({ uri }) => uri),
    [receiptUris.e, receiptUris.f],
  );
  assert.equal(Object.hasOwn(third.body, "cursor"), false);
});

test("listReceipts counts only matching receipts before pagination, even on an empty page", async () => {
  const filters = {
    authors: [publisherA],
    uris: [receiptUris.a, receiptUris.b, receiptUris.c, receiptUris.d],
    from: [sender, senderRecord],
    to: [recipient, recipientRecord],
    forUris: [target],
    transactionIds: ["Tx-CaseSensitive", "Tx-CaseSensitive"],
    sortDirection: "asc",
    limit: 1,
  };
  const first = await listReceipts({ ...filters, includeTotal: true });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.totalCount, 2);
  assert.deepEqual(
    first.body.receipts.map(({ uri }) => uri),
    [receiptUris.a],
  );
  assert.equal(typeof first.body.cursor, "string");

  const next = await listReceipts({ ...filters, includeTotal: true, cursor: first.body.cursor });
  assert.equal(next.response.status, 200, JSON.stringify(next.body));
  assert.equal(next.body.totalCount, 2);
  assert.deepEqual(
    next.body.receipts.map(({ uri }) => uri),
    [receiptUris.b],
  );
  assert.equal(Object.hasOwn(next.body, "cursor"), false);

  // Get a real cursor positioned after the last match of the narrower filter.
  const wider = await listReceipts({ sortDirection: "asc", limit: 2 });
  assert.equal(wider.response.status, 200, JSON.stringify(wider.body));
  assert.equal(typeof wider.body.cursor, "string");
  const empty = await listReceipts({ ...filters, includeTotal: true, cursor: wider.body.cursor });
  assert.equal(empty.response.status, 200, JSON.stringify(empty.body));
  assert.deepEqual(empty.body, { receipts: [], totalCount: 2 });

  const noMatches = await listReceipts({
    ...filters,
    transactionIds: ["no-match"],
    includeTotal: true,
  });
  assert.equal(noMatches.response.status, 200, JSON.stringify(noMatches.body));
  assert.deepEqual(noMatches.body, { receipts: [], totalCount: 0 });

  const omitted = await listReceipts(filters);
  const disabled = await listReceipts({ ...filters, includeTotal: false });
  assert.equal(omitted.response.status, 200, JSON.stringify(omitted.body));
  assert.equal(disabled.response.status, 200, JSON.stringify(disabled.body));
  const { totalCount: _, ...countedPage } = first.body;
  assert.deepEqual(omitted.body, countedPage);
  assert.deepEqual(disabled.body, countedPage);
});

test("listReceipts exposes InvalidRequest using the pinned HappyView runtime error response", async () => {
  const { response, body } = await listReceipts({ limit: 101 });
  // The pinned HappyView release serializes ordinary Lua errors as runtime script_error responses.
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.equal(body.error, "script_error");
  assert.equal(body.errorType, "runtime");
  assert.equal(body.method, "org.hypercerts.funding.listReceipts");
  assert.match(body.message, /InvalidRequest/);
});
