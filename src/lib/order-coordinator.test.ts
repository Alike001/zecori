import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateOrder, attachSourceEvidence, authorizePayout, confirmSourceEvidence, createOrder, expireOrder,
  markUnresolved, queuePayoutApproval, recordPayoutSubmission, type ReceivingAddressBinding, type SourceReceiptLink,
} from './order-coordinator.ts';
import { verifyBaseSepoliaErc20Receipt, verifyZcashShieldedReceipt, type ZcashShieldedReceipt } from './read-only-verification.ts';

const now = Date.parse('2029-01-01T00:00:00.000Z');
const binding: ReceivingAddressBinding = {
  allocationId: 'allocation-001', sourceReceiver: 'utest1completeshieldedreceiver123456789',
  sourceDiversifierIndex: '42', sourceNotBeforeHeight: 501,
};
const input = { allocationId: binding.allocationId, destinationRecipient: `0x${'1'.repeat(40)}`, sourceAmountZat: '1000000', expiresAt: '2029-01-02T00:00:00.000Z' };
const tx = 'a'.repeat(64);
const evmTx = `0x${'b'.repeat(64)}`;

function created() { return createOrder(input, binding, now, 'order-001-long'); }
function source(confirmations = 10): SourceReceiptLink {
  return { transactionId: tx, verifiedAt: '2029-01-01T01:00:00.000Z', verification: 'independent', verifier: 'zcash-rpc-adapter', amountZatoshis: '1000000', outputIndex: 0, diversifierIndex: '42', blockHeight: 510, blockHash: 'c'.repeat(64), blockTime: Math.floor(now / 1000) + 60, confirmations };
}
function rpcEvidence(confirmations = 10): ZcashShieldedReceipt {
  return { orderId: 'order-001-long', transactionId: tx, network: 'zcash-testnet', receiver: binding.sourceReceiver, amount: '0.01', amountZatoshis: '1000000', pool: 'ironwood', status: 'mined', confirmations, blockHeight: 510, blockHash: 'c'.repeat(64), blockTime: Math.floor(now / 1000) + 60, outputIndex: 0, diversifierIndex: '42', shielded: true, independentlyVerified: true };
}

test('creates immutable exact testnet terms with explicit rate, custody, expiry and confirmations', () => {
  const order = created();
  assert.equal(order.status, 'CREATED');
  assert.equal(order.sourceAsset, 'TAZ');
  assert.equal(order.sourceAmountZat, '1000000');
  assert.equal(order.destinationAmountAtomic, '1000000');
  assert.equal(order.destinationChainId, 84532);
  assert.match(order.fixedRate.description, /not a live market quote/);
  assert.match(order.provider.custodyDisclosure, /controls received TAZ/);
  assert.equal(order.sourceMinimumConfirmations, 10);
  assert.equal(activateOrder(order, now + 1).status, 'AWAITING_PAYMENT');
  assert.throws(() => createOrder({ ...input, destinationRecipient: '0x1111…2222' }, binding, now, 'order-002-long'), /complete/);
  assert.throws(() => createOrder({ ...input, providerId: 'unverified-provider' }, binding, now, 'order-003-long'), /not registered/);
});

test('binds source evidence to exact output, allocation height and diversifier', () => {
  const order = activateOrder(created(), now + 1);
  assert.equal(verifyZcashShieldedReceipt(order, rpcEvidence()).outcome, 'verified');
  assert.equal(verifyZcashShieldedReceipt(order, { ...rpcEvidence(), amountZatoshis: '999999' }).outcome, 'rejected');
  assert.equal(verifyZcashShieldedReceipt(order, { ...rpcEvidence(), diversifierIndex: '43' }).outcome, 'rejected');
  assert.equal(verifyZcashShieldedReceipt(order, { ...rpcEvidence(), blockHeight: 500 }).outcome, 'rejected');
  assert.equal(verifyZcashShieldedReceipt(order, { ...rpcEvidence(), blockTime: Math.floor(now / 1000) - 1 }).outcome, 'rejected');
  const detected = attachSourceEvidence(order, source(2), now + 2);
  assert.equal(detected.status, 'SOURCE_DETECTED');
  assert.equal(confirmSourceEvidence(detected, source(10)).status, 'SOURCE_CONFIRMED');
});

test('late payment enters refund pending and timeout without payment fails', () => {
  const order = activateOrder(created(), now + 1);
  assert.equal(attachSourceEvidence(order, source(10), Date.parse(input.expiresAt) + 1).status, 'REFUND_PENDING');
  assert.equal(expireOrder(order, Date.parse(input.expiresAt) + 1).status, 'FAILED');
});

test('requires one-time manual approval and forbids premature or double authorization', () => {
  const confirmed = attachSourceEvidence(activateOrder(created(), now + 1), source(10), now + 2);
  assert.throws(() => recordPayoutSubmission(confirmed, evmTx), /approval/);
  const awaiting = queuePayoutApproval(confirmed);
  assert.throws(() => queuePayoutApproval(awaiting), /Confirmed source|already/);
  const approved = authorizePayout(awaiting, 'operator-1', 'authorization-1', now + 3);
  assert.throws(() => authorizePayout(approved, 'operator-1', 'authorization-2'), /not awaiting/);
  const submitted = recordPayoutSubmission(approved, evmTx, now + 4);
  assert.equal(submitted.status, 'PAYOUT_SUBMITTED');
  assert.equal(submitted.payoutAuthorization.state, 'CONSUMED');
  assert.throws(() => recordPayoutSubmission(submitted, evmTx), /approval/);
});

test('rejects wrong Base terms and keeps uncertain broadcast distinct from completion', () => {
  const order = created();
  const wrong = verifyBaseSepoliaErc20Receipt(order, { orderId: order.id, transactionId: evmTx, chainId: 84532, tokenContract: order.destinationAsset.contract, recipient: `0x${'2'.repeat(40)}`, amountAtomic: order.destinationAmountAtomic, independentlyVerified: true });
  assert.equal(wrong.outcome, 'rejected');
  const unresolved = markUnresolved(activateOrder(order), 'uncertain-payout-broadcast');
  assert.equal(unresolved.status, 'UNRESOLVED');
  assert.equal(unresolved.finalReceiptId, undefined);
});
