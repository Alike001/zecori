import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createPostgresPool, migrateDatabase } from './postgres.ts';
import { PostgresPublicOrderRequestStore } from './public-order-store.ts';
import { DataEncryption } from './data-encryption.ts';
import { PostgresSettlementStore } from './postgres-settlement-store.ts';
import { BASE_USDC } from '../src/lib/order-coordinator.ts';
import { PrivateVerificationRelay } from './private-verification-relay.ts';
import { relayFingerprint, signRelayEvidence, verifyRelayChallenge, type RelayEvidencePayload } from './private-verification-protocol.ts';

const databaseUrl = process.env.POSTGRES_TEST_URL;
function testOnlyTransaction(label: string, orderId: string): string { return createHash('sha256').update(`TEST-ONLY:${label}:${orderId}`).digest('hex'); }

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

test('TEST-ONLY production lifecycle is concurrent-safe, encrypted, owner-scoped, recoverable, and rollback-safe', { skip: !databaseUrl }, async t => {
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
  const sourceTransactionId = testOnlyTransaction('source-replay', request.id);
  const ownerView = await requests.get(owner, request.id); const strangerView = await requests.get(stranger, request.id);
  assert.equal(ownerView?.paymentInstructions?.receiver, candidate.address); assert.equal(strangerView, undefined);
  assert.ok(ownerView?.timeline?.some(item => item.type === 'PAYMENT_INSTRUCTIONS_PUBLISHED'));
  const raw = await pool.query<{ encrypted_private_state: Buffer; encrypted_payment_receiver: Buffer }>(`SELECT o.encrypted_private_state,r.encrypted_payment_receiver FROM orders o JOIN public_order_requests r ON r.request_id=o.order_id WHERE o.order_id=$1`, [request.id]);
  assert.ok(!raw.rows[0].encrypted_private_state.toString().includes(candidate.address)); assert.ok(!raw.rows[0].encrypted_payment_receiver.toString().includes(candidate.address));

  await assert.rejects(settlements.observeSource(request.id, sourceTransactionId, async () => { throw new Error('partial RPC failure'); }), /partial RPC failure/);
  assert.equal((await requests.get(owner, request.id))?.status, 'PAYMENT_READY');
  const sourceVerifier = async (input: { orderId: string; transactionId: string; receiver: string; expectedDiversifierIndex?: string }) => ({
    orderId: input.orderId, transactionId: input.transactionId, network: 'zcash-testnet' as const, receiver: input.receiver,
    amount: '0.01', amountZatoshis: '1000000', pool: 'ironwood' as const, status: 'mined' as const, confirmations: 10,
    blockHeight: 510, blockHash: 'c'.repeat(64), blockTime: Math.floor(Date.now() / 1000), outputIndex: 0,
    diversifierIndex: input.expectedDiversifierIndex!, shielded: true as const, independentlyVerified: true as const,
  });
  await settlements.observeSource(request.id, sourceTransactionId, sourceVerifier);

  const owner2 = randomUUID(); const request2 = await requests.create(owner2, `0x${randomBytes(20).toString('hex')}`);
  await settlements.acceptRequest(request2.id, 'operator-integration', request2.destinationRecipient, async () => 'a'.repeat(64));
  const auth2 = await settlements.issueAuthorization(request2.id, 'ADDRESS_ALLOCATION', 'operator-integration', async () => 'b'.repeat(64));
  const candidate2 = { ...candidate, allocationId: randomUUID(), address: `utest1${randomBytes(32).toString('hex')}`, diversifierIndex: (diversifierBase + 1n).toString() };
  await settlements.reserveValidatedAllocation(request2.id, 'operator-integration', auth2, verifyAuthorization, candidate2); await settlements.publishPaymentInstructions(request2.id, 'operator-integration');
  await assert.rejects(settlements.observeSource(request2.id, sourceTransactionId, sourceVerifier), /duplicate key|unique constraint/i);
  assert.equal((await requests.get(owner2, request2.id))?.status, 'PAYMENT_READY');

  const owner3 = randomUUID(); const request3 = await requests.create(owner3, `0x${randomBytes(20).toString('hex')}`);
  await settlements.acceptRequest(request3.id, 'operator-integration', request3.destinationRecipient, async () => 'a'.repeat(64));
  const auth3 = await settlements.issueAuthorization(request3.id, 'ADDRESS_ALLOCATION', 'operator-integration', async () => 'b'.repeat(64));
  const candidate3 = { ...candidate, allocationId: randomUUID(), address: `utest1${randomBytes(32).toString('hex')}`, diversifierIndex: (diversifierBase + 2n).toString() };
  await settlements.reserveValidatedAllocation(request3.id, 'operator-integration', auth3, verifyAuthorization, candidate3); await settlements.publishPaymentInstructions(request3.id, 'operator-integration');
  await settlements.observeSource(request3.id, testOnlyTransaction('source-complete', request3.id), sourceVerifier); await settlements.queuePayout(request3.id, 'operator-integration');
  const payoutAuth = await settlements.issueAuthorization(request3.id, 'PAYOUT', 'operator-integration', async () => 'b'.repeat(64));
  await settlements.approvePayout(request3.id, 'operator-integration', payoutAuth, verifyAuthorization);
  const payoutTx = `0x${testOnlyTransaction('destination-complete', request3.id)}`; await settlements.recordPayout(request3.id, 'operator-integration', payoutTx);
  const receiptId = await settlements.verifyPayout(request3.id, async () => 'f'.repeat(64), async input => ({ orderId: input.orderId, transactionId: input.transactionId, chainId: 84532, tokenContract: BASE_USDC, recipient: input.recipient, amountAtomic: input.amountAtomic, independentlyVerified: true }));
  assert.equal((await requests.get(owner3, request3.id))?.status, 'COMPLETED');
  assert.ok(await requests.getShareableReceipt(receiptId)); assert.ok(await requests.getPrivateReceipt(owner3, receiptId)); assert.equal(await requests.getPrivateReceipt(stranger, receiptId), undefined);
  const receiptAuth = await pool.query<{ authenticity_hmac: Buffer }>('SELECT authenticity_hmac FROM receipts WHERE receipt_id=$1', [receiptId]); assert.equal(receiptAuth.rows[0].authenticity_hmac.toString('hex'), 'f'.repeat(64));
  assert.deepEqual(await settlements.verifyReceiptAuthenticity(receiptId, async (_value, signature) => { assert.equal(signature, 'f'.repeat(64)); }), { authentic: true, orderId: request3.id });
  const restarted = createPostgresPool(databaseUrl); const recovered = new PostgresPublicOrderRequestStore(restarted, encryption);
  assert.equal((await recovered.get(owner, request.id))?.paymentInstructions?.receiver, candidate.address);
  await restarted.end();
});

test('TEST-ONLY private verifier relay survives leases, rejects replay, applies two stages, and preserves unresolved', { skip: !databaseUrl }, async t => {
  const pool = createPostgresPool(databaseUrl); await migrateDatabase(pool);
  t.after(async () => { await pool.end().catch(() => undefined); });
  const encryption = new DataEncryption({ activeVersion: 8, keys: new Map([[8, randomBytes(32)]]) });
  const relayEncryption = new DataEncryption({ activeVersion: 9, keys: new Map([[9, randomBytes(32)]]) });
  const requests = new PostgresPublicOrderRequestStore(pool, encryption); const settlements = new PostgresSettlementStore(pool, encryption);
  const coordinator = generateKeyPairSync('ed25519'); const verifier = generateKeyPairSync('ed25519'); const verifierId = 'operator-zcash-test';
  const relay = new PrivateVerificationRelay(pool, relayEncryption, coordinator.privateKey, new Map([[verifierId, verifier.publicKey]]), encryption);
  const owner = randomUUID(); const request = await requests.create(owner, `0x${randomBytes(20).toString('hex')}`);
  await settlements.acceptRequest(request.id, 'operator-relay-test', request.destinationRecipient, async () => 'a'.repeat(64));
  const authorizationId = await settlements.issueAuthorization(request.id, 'ADDRESS_ALLOCATION', 'operator-relay-test', async () => 'b'.repeat(64));
  const verifyAuthorization = async (_domain: string, _payload: string, signature: string) => { if (signature !== 'b'.repeat(64)) throw new Error('forged authorization'); };
  const relayDiversifier = BigInt(`0x${randomBytes(8).toString('hex')}`).toString();
  const candidate = { allocationId: randomUUID(), address: `utest1${randomBytes(32).toString('hex')}`, diversifierIndex: relayDiversifier, validatedAt: new Date().toISOString(), sourceNotBeforeHeight: 500, state: 'AVAILABLE' as const };
  await settlements.reserveValidatedAllocation(request.id, 'operator-relay-test', authorizationId, verifyAuthorization, candidate); await settlements.publishPaymentInstructions(request.id, 'operator-relay-test');
  const started = Date.now(); const transactionId = testOnlyTransaction('relay-source', request.id);
  const detectionJob = await relay.createSourceJob({ orderId: request.id, transactionId, phase: 'SOURCE_DETECTION', verifierId }, started);
  const challenge = await relay.claim(verifierId, started + 1_000, 10_000); assert.ok(challenge); verifyRelayChallenge(challenge, coordinator.publicKey, verifierId, started + 1_000);
  assert.equal(await relay.claim(verifierId, started + 2_000, 10_000), undefined);
  const reclaimed = await relay.claim(verifierId, started + 11_001, 10_000); assert.equal(reclaimed?.payload.jobId, detectionJob);
  const baseEvidence = { orderId: request.id, transactionId, network: 'zcash-testnet' as const, receiver: candidate.address, amount: '0.01', amountZatoshis: '1000000', pool: 'ironwood' as const, status: 'mined' as const, blockHeight: 510, blockHash: 'c'.repeat(64), blockTime: Math.floor(started / 1000) + 1, outputIndex: 0, diversifierIndex: relayDiversifier, shielded: true as const, independentlyVerified: true as const };
  const detectionPayload: RelayEvidencePayload = { version: 1, jobId: detectionJob, verifierId, phase: 'SOURCE_DETECTION', nonce: challenge.payload.nonce, orderId: request.id, manifestFingerprint: challenge.payload.manifestFingerprint, requestFingerprint: relayFingerprint(challenge.payload.request), observedAt: new Date(started + 12_000).toISOString(), expiresAt: new Date(started + 60_000).toISOString(), outcome: 'VERIFIED', evidence: { ...baseEvidence, confirmations: 1 } };
  const detectionEnvelope = signRelayEvidence(detectionPayload, verifier.privateKey);
  assert.equal(await relay.submit(detectionEnvelope, started + 13_000), 'RECEIVED');
  await assert.rejects(relay.submit(detectionEnvelope, started + 13_001), /no longer accepting/);
  await settlements.applyRelaySourceEvidence(detectionJob, await relay.verifiedMessage(detectionJob, coordinator.publicKey, started + 14_000), started + 14_000);
  assert.equal((await requests.get(owner, request.id))?.status, 'SOURCE_DETECTED');
  const confirmationJob = await relay.createSourceJob({ orderId: request.id, transactionId, phase: 'SOURCE_CONFIRMATION', verifierId }, started + 15_000);
  const confirmationChallenge = await relay.claim(verifierId, started + 16_000); assert.ok(confirmationChallenge);
  const confirmationPayload: RelayEvidencePayload = { ...detectionPayload, jobId: confirmationJob, phase: 'SOURCE_CONFIRMATION', nonce: confirmationChallenge.payload.nonce, manifestFingerprint: confirmationChallenge.payload.manifestFingerprint, requestFingerprint: relayFingerprint(confirmationChallenge.payload.request), observedAt: new Date(started + 17_000).toISOString(), evidence: { ...baseEvidence, confirmations: 10 } };
  const confirmationEnvelope = signRelayEvidence(confirmationPayload, verifier.privateKey);
  assert.equal(await relay.submit(confirmationEnvelope, started + 18_000), 'RECEIVED');
  await settlements.applyRelaySourceEvidence(confirmationJob, await relay.verifiedMessage(confirmationJob, coordinator.publicKey, started + 19_000), started + 19_000);
  assert.equal((await requests.get(owner, request.id))?.status, 'SOURCE_CONFIRMED');

  const unresolvedOwner = randomUUID(); const unresolvedRequest = await requests.create(unresolvedOwner, `0x${randomBytes(20).toString('hex')}`, started + 20_000);
  await settlements.acceptRequest(unresolvedRequest.id, 'operator-relay-test', unresolvedRequest.destinationRecipient, async () => 'a'.repeat(64), started + 20_001);
  const unresolvedAuthorization = await settlements.issueAuthorization(unresolvedRequest.id, 'ADDRESS_ALLOCATION', 'operator-relay-test', async () => 'b'.repeat(64), started + 20_002);
  const unresolvedCandidate = { ...candidate, allocationId: randomUUID(), address: `utest1${randomBytes(32).toString('hex')}`, diversifierIndex: (BigInt(relayDiversifier) + 1n).toString() };
  await settlements.reserveValidatedAllocation(unresolvedRequest.id, 'operator-relay-test', unresolvedAuthorization, verifyAuthorization, unresolvedCandidate, started + 20_003); await settlements.publishPaymentInstructions(unresolvedRequest.id, 'operator-relay-test', started + 20_004);
  const unresolvedTx = testOnlyTransaction('relay-unresolved', unresolvedRequest.id); const unresolvedJob = await relay.createSourceJob({ orderId: unresolvedRequest.id, transactionId: unresolvedTx, phase: 'SOURCE_DETECTION', verifierId }, started + 21_000);
  const unresolvedChallenge = await relay.claim(verifierId, started + 22_000); assert.ok(unresolvedChallenge);
  const unresolvedPayload: RelayEvidencePayload = { version: 1, jobId: unresolvedJob, verifierId, phase: 'SOURCE_DETECTION', nonce: unresolvedChallenge.payload.nonce, orderId: unresolvedRequest.id, manifestFingerprint: unresolvedChallenge.payload.manifestFingerprint, requestFingerprint: relayFingerprint(unresolvedChallenge.payload.request), observedAt: new Date(started + 23_000).toISOString(), expiresAt: new Date(started + 60_000).toISOString(), outcome: 'UNRESOLVED', reasonCode: 'RPC_UNAVAILABLE' };
  assert.equal(await relay.submit(signRelayEvidence(unresolvedPayload, verifier.privateKey), started + 24_000), 'UNRESOLVED');
  await settlements.applyRelayUnresolved(unresolvedJob, await relay.verifiedMessage(unresolvedJob, coordinator.publicKey, started + 25_000), started + 25_000);
  assert.equal((await requests.get(unresolvedOwner, unresolvedRequest.id))?.status, 'UNRESOLVED');
  await assert.rejects(settlements.applyRelayUnresolved(unresolvedJob, signRelayEvidence(unresolvedPayload, verifier.privateKey), started + 25_001), /not unresolved/);
  const raw = await pool.query<{ encrypted_envelope: Buffer }>('SELECT encrypted_envelope FROM private_verification_messages WHERE job_id=$1', [confirmationJob]);
  assert.ok(!raw.rows[0].encrypted_envelope.toString().includes(candidate.address));
});
