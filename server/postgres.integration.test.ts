import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createPostgresPool, migrateDatabase } from './postgres.ts';
import { PostgresPublicOrderRequestStore } from './public-order-store.ts';
import { DataEncryption } from './data-encryption.ts';
import { PostgresSettlementStore } from './postgres-settlement-store.ts';
import { BASE_USDC } from '../src/lib/order-coordinator.ts';

const databaseUrl = process.env.POSTGRES_TEST_URL;

test('PostgreSQL migration, concurrent request idempotency, restart persistence, and immutable audit constraints', { skip: !databaseUrl }, async () => {
  const firstPool = createPostgresPool(databaseUrl);
  await migrateDatabase(firstPool);
  const firstStore = new PostgresPublicOrderRequestStore(firstPool);
  const owner = randomUUID(); const recipient = `0x${'4'.repeat(40)}`;
  const attempts = await Promise.all(Array.from({ length: 8 }, () => firstStore.create(owner, recipient)));
  assert.equal(new Set(attempts.map(item => item.id)).size, 1);
  const id = attempts[0].id;
  await firstPool.end();

  const restartedPool = createPostgresPool(databaseUrl);
  const restartedStore = new PostgresPublicOrderRequestStore(restartedPool);
  assert.equal((await restartedStore.get(owner, id))?.destinationRecipient, recipient);

  const orderId = randomUUID(); const now = new Date(); const later = new Date(now.getTime() + 3_600_000);
  await restartedPool.query(`INSERT INTO orders
    (order_id, owner_session_hash, immutable_manifest, manifest_signature, accepted_by, public_view, encrypted_private_state, encryption_key_version, status, created_at, expires_at, updated_at)
    VALUES ($1,$2,$3,$4,'integration-test',$5,$6,1,'CREATED',$7,$8,$7)`, [orderId, createHash('sha256').update(owner).digest(), { exact: true }, Buffer.alloc(32), { id: orderId }, Buffer.from('encrypted-fixture'), now, later]);
  await assert.rejects(restartedPool.query(`UPDATE orders SET immutable_manifest = $2, state_version = 1, updated_at = now() WHERE order_id = $1`, [orderId, { exact: false }]), /immutable order fields/);
  const audit = await restartedPool.query<{ event_id: string }>(`INSERT INTO audit_events(order_id, actor_type, event_type) VALUES ($1,'SYSTEM','TEST') RETURNING event_id`, [orderId]);
  await assert.rejects(restartedPool.query(`UPDATE audit_events SET event_type = 'ALTERED' WHERE event_id = $1`, [audit.rows[0].event_id]), /append-only/);
  await restartedPool.end();
});

test('PostgreSQL settlement acceptance is concurrent-safe, encrypted, owner-scoped, recoverable, and rollback-safe', { skip: !databaseUrl }, async t => {
  const pool = createPostgresPool(databaseUrl); await migrateDatabase(pool);
  t.after(async () => { await pool.end().catch(() => undefined); });
  const encryption = new DataEncryption({ activeVersion: 7, keys: new Map([[7, randomBytes(32)]]) });
  const requests = new PostgresPublicOrderRequestStore(pool, encryption); const settlements = new PostgresSettlementStore(pool, encryption);
  const owner = randomUUID(); const stranger = randomUUID(); const recipient = `0x${randomBytes(20).toString('hex')}`;
  const request = await requests.create(owner, recipient);
  const accepted = await Promise.allSettled(Array.from({ length: 6 }, () => settlements.acceptRequest(request.id, 'operator-integration', recipient, async () => 'a'.repeat(64))));
  assert.equal(accepted.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(accepted.filter(item => item.status === 'rejected').length, 5);

  const authorizationId = await settlements.issueAuthorization(request.id, 'ADDRESS_ALLOCATION', 'operator-integration', async () => 'b'.repeat(64));
  const verifyAuthorization = async (_domain: string, _payload: string, signature: string) => { if (signature !== 'b'.repeat(64)) throw new Error('forged authorization'); };
  const diversifierBase = BigInt(`0x${randomBytes(8).toString('hex')}`);
  const candidate = { allocationId: randomUUID(), address: `utest1${randomBytes(32).toString('hex')}`, diversifierIndex: diversifierBase.toString(), validatedAt: new Date().toISOString(), sourceNotBeforeHeight: 500, state: 'AVAILABLE' as const };
  await assert.rejects(settlements.reserveValidatedAllocation(request.id, 'wrong-operator', authorizationId, verifyAuthorization, candidate), /wrong identity/);
  const authorization = await pool.query<{ state: string }>('SELECT state FROM authorization_records WHERE authorization_id=$1', [authorizationId]);
  assert.equal(authorization.rows[0].state, 'ISSUED');
  await settlements.reserveValidatedAllocation(request.id, 'operator-integration', authorizationId, verifyAuthorization, candidate);
  await settlements.publishPaymentInstructions(request.id, 'operator-integration');
  const ownerView = await requests.get(owner, request.id); const strangerView = await requests.get(stranger, request.id);
  assert.equal(ownerView?.paymentInstructions?.receiver, candidate.address); assert.equal(strangerView, undefined);
  assert.ok(ownerView?.timeline?.some(item => item.type === 'PAYMENT_INSTRUCTIONS_PUBLISHED'));
  const raw = await pool.query<{ encrypted_private_state: Buffer; encrypted_payment_receiver: Buffer }>(`SELECT o.encrypted_private_state,r.encrypted_payment_receiver FROM orders o JOIN public_order_requests r ON r.request_id=o.order_id WHERE o.order_id=$1`, [request.id]);
  assert.ok(!raw.rows[0].encrypted_private_state.toString().includes(candidate.address)); assert.ok(!raw.rows[0].encrypted_payment_receiver.toString().includes(candidate.address));

  await assert.rejects(settlements.observeSource(request.id, 'a'.repeat(64), async () => { throw new Error('partial RPC failure'); }), /partial RPC failure/);
  assert.equal((await requests.get(owner, request.id))?.status, 'PAYMENT_READY');
  const sourceVerifier = async (input: { orderId: string; transactionId: string; receiver: string; expectedDiversifierIndex?: string }) => ({
    orderId: input.orderId, transactionId: input.transactionId, network: 'zcash-testnet' as const, receiver: input.receiver,
    amount: '0.01', amountZatoshis: '1000000', pool: 'ironwood' as const, status: 'mined' as const, confirmations: 10,
    blockHeight: 510, blockHash: 'c'.repeat(64), blockTime: Math.floor(Date.now() / 1000), outputIndex: 0,
    diversifierIndex: input.expectedDiversifierIndex!, shielded: true as const, independentlyVerified: true as const,
  });
  await settlements.observeSource(request.id, 'a'.repeat(64), sourceVerifier);

  const owner2 = randomUUID(); const request2 = await requests.create(owner2, `0x${randomBytes(20).toString('hex')}`);
  await settlements.acceptRequest(request2.id, 'operator-integration', request2.destinationRecipient, async () => 'a'.repeat(64));
  const auth2 = await settlements.issueAuthorization(request2.id, 'ADDRESS_ALLOCATION', 'operator-integration', async () => 'b'.repeat(64));
  const candidate2 = { ...candidate, allocationId: randomUUID(), address: `utest1${randomBytes(32).toString('hex')}`, diversifierIndex: (diversifierBase + 1n).toString() };
  await settlements.reserveValidatedAllocation(request2.id, 'operator-integration', auth2, verifyAuthorization, candidate2); await settlements.publishPaymentInstructions(request2.id, 'operator-integration');
  await assert.rejects(settlements.observeSource(request2.id, 'a'.repeat(64), sourceVerifier), /duplicate key|unique constraint/i);
  assert.equal((await requests.get(owner2, request2.id))?.status, 'PAYMENT_READY');

  const owner3 = randomUUID(); const request3 = await requests.create(owner3, `0x${randomBytes(20).toString('hex')}`);
  await settlements.acceptRequest(request3.id, 'operator-integration', request3.destinationRecipient, async () => 'a'.repeat(64));
  const auth3 = await settlements.issueAuthorization(request3.id, 'ADDRESS_ALLOCATION', 'operator-integration', async () => 'b'.repeat(64));
  const candidate3 = { ...candidate, allocationId: randomUUID(), address: `utest1${randomBytes(32).toString('hex')}`, diversifierIndex: (diversifierBase + 2n).toString() };
  await settlements.reserveValidatedAllocation(request3.id, 'operator-integration', auth3, verifyAuthorization, candidate3); await settlements.publishPaymentInstructions(request3.id, 'operator-integration');
  await settlements.observeSource(request3.id, 'd'.repeat(64), sourceVerifier); await settlements.queuePayout(request3.id, 'operator-integration');
  const payoutAuth = await settlements.issueAuthorization(request3.id, 'PAYOUT', 'operator-integration', async () => 'b'.repeat(64));
  await settlements.approvePayout(request3.id, 'operator-integration', payoutAuth, verifyAuthorization);
  const payoutTx = `0x${'e'.repeat(64)}`; await settlements.recordPayout(request3.id, 'operator-integration', payoutTx);
  const receiptId = await settlements.verifyPayout(request3.id, async () => 'f'.repeat(64), async input => ({ orderId: input.orderId, transactionId: input.transactionId, chainId: 84532, tokenContract: BASE_USDC, recipient: input.recipient, amountAtomic: input.amountAtomic, independentlyVerified: true }));
  assert.equal((await requests.get(owner3, request3.id))?.status, 'COMPLETED');
  assert.ok(await requests.getShareableReceipt(receiptId)); assert.ok(await requests.getPrivateReceipt(owner3, receiptId)); assert.equal(await requests.getPrivateReceipt(stranger, receiptId), undefined);
  const receiptAuth = await pool.query<{ authenticity_hmac: Buffer }>('SELECT authenticity_hmac FROM receipts WHERE receipt_id=$1', [receiptId]); assert.equal(receiptAuth.rows[0].authenticity_hmac.toString('hex'), 'f'.repeat(64));
  assert.deepEqual(await settlements.verifyReceiptAuthenticity(receiptId, async (_value, signature) => { assert.equal(signature, 'f'.repeat(64)); }), { authentic: true, orderId: request3.id });
  const restarted = createPostgresPool(databaseUrl); const recovered = new PostgresPublicOrderRequestStore(restarted, encryption);
  assert.equal((await recovered.get(owner, request.id))?.paymentInstructions?.receiver, candidate.address);
  await restarted.end();
});
