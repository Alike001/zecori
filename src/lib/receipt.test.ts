import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateOrder, attachDestinationEvidence, attachSourceEvidence, authorizePayout, completeOrder, createOrder,
  markRefundPending, markRefunded, markUnresolved, queuePayoutApproval, recordPayoutSubmission,
  type DestinationReceiptLink, type SourceReceiptLink,
} from './order-coordinator.ts';
import { createFinalReceipt, toShareableReceipt } from './receipt.ts';

const now = Date.parse('2029-01-01T00:00:00.000Z');
const source: SourceReceiptLink = { transactionId: 'a'.repeat(64), verifiedAt: '2029-01-01T01:00:00.000Z', verification: 'independent', verifier: 'zcash-rpc-adapter', amountZatoshis: '1000000', outputIndex: 0, diversifierIndex: '42', blockHeight: 510, blockHash: 'c'.repeat(64), blockTime: Math.floor(now / 1000) + 60, confirmations: 10 };
const destination: DestinationReceiptLink = { transactionId: `0x${'b'.repeat(64)}`, verifiedAt: '2029-01-01T02:00:00.000Z', verification: 'independent', verifier: 'base-rpc-adapter', amountAtomic: '1000000' };

function order() {
  return createOrder(
    { allocationId: 'allocation-001', destinationRecipient: `0x${'1'.repeat(40)}`, sourceAmountZat: '1000000', expiresAt: '2029-01-02T00:00:00.000Z' },
    { allocationId: 'allocation-001', sourceReceiver: 'utest1completeshieldedreceiver123456789', sourceDiversifierIndex: '42', sourceNotBeforeHeight: 501 },
    now, 'receipt-order-001',
  );
}

function submitted() {
  const confirmed = attachSourceEvidence(activateOrder(order(), now + 1), source, now + 2);
  const approved = authorizePayout(queuePayoutApproval(confirmed), 'operator-1', 'authorization-1', now + 3);
  return recordPayoutSubmission(approved, destination.transactionId, now + 4);
}

test('does not issue a final receipt before same-order destination evidence', () => {
  assert.throws(() => createFinalReceipt(submitted(), source, destination, 'receipt-premature'), /requires independently verified/);
  const ready = attachDestinationEvidence(submitted(), destination);
  assert.throws(() => createFinalReceipt(ready, { ...source, amountZatoshis: '999999' }, destination, 'receipt-wrong'), /amounts/);
});

test('completes only after both linked sides and redacts private correlation data', () => {
  const ready = attachDestinationEvidence(submitted(), destination);
  const receipt = createFinalReceipt(ready, source, destination, 'receipt-final-001');
  const completed = completeOrder(ready, receipt.receiptId);
  assert.equal(completed.status, 'COMPLETED');
  assert.throws(() => completeOrder(completed, receipt.receiptId), /Both independently verified/);
  const shareable = toShareableReceipt(receipt);
  for (const field of ['sourceTransactionId', 'sourceReceiver', 'orderId', 'destinationTransactionHash', 'verifiedSourceAmount', 'sourceSettlementTimestamp', 'actualKnownFees', 'sourceChain', 'sourceAsset']) assert.equal(field in shareable, false);
  assert.equal(shareable.privacyClassification, 'redacted-shareable');
});

test('refund and unresolved states cannot masquerade as completion', () => {
  const received = attachSourceEvidence(activateOrder(order(), now + 1), source, now + 2);
  const unresolved = markUnresolved(received, 'source-reorganization');
  const pending = markRefundPending(unresolved);
  assert.equal(pending.status, 'REFUND_PENDING');
  assert.throws(() => markRefunded(pending, false), /independent/);
  assert.equal(markRefunded(pending, true).status, 'REFUNDED');
});
