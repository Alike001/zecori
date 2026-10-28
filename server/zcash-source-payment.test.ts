import assert from 'node:assert/strict';
import test from 'node:test';
import { activateOrder, createOrder } from '../src/lib/order-coordinator.ts';
import type { RpcCall } from './rpc-client.ts';
import { prepareWalletASigningPacket, type SourcePaymentOperation, type SourcePaymentOperationState } from './zcash-signing-packet.ts';
import { recoverWalletASourcePayment, sourcePaymentReview, submitWalletASourcePayment, type SourcePaymentOperationStore } from './zcash-source-payment.ts';
import type { SourceWalletHealth, SourceWalletSubmissionHealth } from './zcash-source-wallet.ts';

const now = Date.parse('2026-10-28T12:00:00.000Z'); const receiver = `utest1${'a'.repeat(64)}`;
const order = activateOrder(createOrder({ allocationId: 'allocation-fixture', destinationRecipient: `0x${'1'.repeat(40)}`, sourceAmountZat: '1000000', expiresAt: new Date(now + 30 * 60_000).toISOString() }, { allocationId: 'allocation-fixture', sourceReceiver: receiver, sourceDiversifierIndex: '42', sourceNotBeforeHeight: 500 }, now, '00000000-0000-4000-8000-000000000111'), now + 1);
const health: SourceWalletHealth = { network: 'zcash-testnet', synchronized: true, historyComplete: true, locked: true, walletOwned: true, walletName: 'default', blocks: 600, account: 0, minimumConfirmations: 10, confirmedZatoshis: '98465000', aggregateConfirmedZatoshis: '98465000', ironwoodUsableZatoshis: '98465000', poolZatoshis: { ironwood: '98465000', orchard: '0' }, requiredZatoshis: '1010000', sufficientForPaymentAndFeeReserve: true, fullPrivacyCompatible: true };
const unlocked: SourceWalletSubmissionHealth = { ...health, locked: false, unlockedUntil: Math.floor(now / 1_000) + 60 };

function memoryStore(): SourcePaymentOperationStore & { current: SourcePaymentOperation; transitions: string[] } {
  const packet = prepareWalletASigningPacket(order, health, now + 2); const transitions: string[] = [];
  const store = { current: { operationId: 'operation-1', orderId: order.id, state: 'PREPARED', packet, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() } as SourcePaymentOperation, transitions,
    async load() { return this.current; }, async beginSubmission() { transitions.push('BEGIN'); this.current = { ...this.current, state: 'SUBMISSION_STARTED' }; },
    async recordOpid(_id: string, opid: string) { transitions.push('OPID'); this.current = { ...this.current, state: 'OPID_RECORDED', opid }; },
    async recordRecoveredOpid(_id: string, opid: string) { transitions.push('RECOVER_OPID'); this.current = { ...this.current, state: 'OPID_RECORDED', opid }; },
    async markSubmissionAmbiguous() { transitions.push('AMBIGUOUS'); this.current = { ...this.current, state: 'SUBMISSION_AMBIGUOUS', recoveryReason: 'ambiguous' }; },
    async requireRecovery(_id: string, reason: string) { transitions.push('RECOVERY'); this.current = { ...this.current, state: 'RECOVERY_REQUIRED', recoveryReason: reason }; },
    async recordTxid(_id: string, txid: string) { transitions.push('TXID'); this.current = { ...this.current, state: 'TXID_RECORDED', txid }; },
    async recordRecoveredTxid(_id: string, txid: string) { transitions.push('RECOVER_TXID'); this.current = { ...this.current, state: 'TXID_RECORDED', txid }; },
  }; return store;
}

test('dry-run review is exact, memo-free, fee-reviewed, and redacts the receiver', () => {
  const packet = prepareWalletASigningPacket(order, health, now + 2); const review = sourcePaymentReview(packet);
  assert.equal(review.sourceAmountZatoshis, '1000000'); assert.equal(review.memo, 'OMITTED'); assert.equal(review.feeReserveZatoshis, '10000');
  assert.equal(review.broadcastPerformed, false); assert.equal(JSON.stringify(review).includes(receiver), false);
});

test('submission journals the one-attempt boundary before the exact mocked z_sendmany call', async () => {
  const store = memoryStore(); const calls: Array<[string, unknown[] | undefined]> = [];
  const rpc: RpcCall = async <T>(method: string, params?: unknown[]) => { calls.push([method, params]); return 'opid-fixture' as T; };
  await submitWalletASourcePayment({ store, operationId: store.current.operationId, packetDigest: store.current.packet.packetDigest, wallet: unlocked, rpc, now: now + 3 });
  assert.deepEqual(store.transitions, ['BEGIN', 'OPID']); assert.equal(calls[0][0], 'z_sendmany');
  assert.deepEqual((calls[0][1]?.[1] as Array<Record<string, unknown>>)[0].address, receiver);
  assert.equal(Object.hasOwn((calls[0][1]?.[1] as Array<Record<string, unknown>>)[0], 'memo'), false);
  await assert.rejects(submitWalletASourcePayment({ store, operationId: store.current.operationId, packetDigest: store.current.packet.packetDigest, wallet: unlocked, rpc, now: now + 4 }), /one-time packet/);
});

test('lost submit response is durable and recovery records only the exact successful operation', async () => {
  const store = memoryStore(); const lost: RpcCall = async () => { throw new Error('TEST-ONLY response lost'); };
  await assert.rejects(submitWalletASourcePayment({ store, operationId: store.current.operationId, packetDigest: store.current.packet.packetDigest, wallet: unlocked, rpc: lost, now: now + 3 }), /never call z_sendmany again/);
  assert.deepEqual(store.transitions, ['BEGIN', 'AMBIGUOUS']);
  const txid = 'b'.repeat(64); const calls: string[] = [];
  const recovery: RpcCall = async <T>(method: string) => { calls.push(method); return (method === 'walletlock' ? null : [{ operationid: 'opid-recovered', status: 'success', method: 'z_sendmany', params: ['ANY_ORCHARD', [{ address: receiver, amount: '0.01000000' }], 10, null, 'FullPrivacy'], result: { txid } }]) as T; };
  const result = await recoverWalletASourcePayment({ store, operationId: store.current.operationId, rpc: recovery, now: now + 4 });
  assert.deepEqual(store.transitions, ['BEGIN', 'AMBIGUOUS', 'RECOVER_OPID', 'TXID']); assert.deepEqual(calls, ['z_getoperationstatus', 'z_getoperationstatus', 'walletlock']);
  assert.deepEqual(result, { state: 'TXID_RECORDED', terminal: true, walletRelocked: true, transactionId: txid });
});

test('failed or mismatched recovery never authorizes a second broadcast', async () => {
  const store = memoryStore(); store.current = { ...store.current, state: 'SUBMISSION_AMBIGUOUS' as SourcePaymentOperationState, recoveryReason: 'lost' };
  const wrong: RpcCall = async <T>() => [{ operationid: 'opid-wrong', status: 'success', method: 'z_sendmany', params: ['ANY_ORCHARD', [{ address: `utest1${'c'.repeat(64)}`, amount: '0.01000000' }], 10, null, 'FullPrivacy'], result: { txid: 'd'.repeat(64) } }] as T;
  await assert.rejects(recoverWalletASourcePayment({ store, operationId: store.current.operationId, rpc: wrong, now: now + 5 }), /must not be repeated/);
  assert.equal(store.current.state, 'RECOVERY_REQUIRED'); assert.equal(store.transitions.includes('BEGIN'), false);
});

test('manual recovery durably records an independently reviewed txid without resubmission', async () => {
  const store = memoryStore(); store.current = { ...store.current, state: 'RECOVERY_REQUIRED', recoveryReason: 'status-missing' };
  const calls: string[] = []; const rpc: RpcCall = async <T>(method: string) => { calls.push(method); return null as T; }; const txid = 'e'.repeat(64);
  const result = await recoverWalletASourcePayment({ store, operationId: store.current.operationId, rpc, recoveredTxid: txid, now: now + 6 });
  assert.deepEqual(store.transitions, ['RECOVER_TXID']); assert.deepEqual(calls, ['walletlock']);
  assert.deepEqual(result, { state: 'TXID_RECORDED', terminal: true, walletRelocked: true, transactionId: txid });
});
