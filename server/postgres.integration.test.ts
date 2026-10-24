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
import { executePostgresAddressAllocation } from './postgres-address-allocation.ts';
import type { RpcCall } from './rpc-client.ts';

const databaseUrl = process.env.POSTGRES_TEST_URL;
function testOnlyTransaction(label: string, orderId: string): string { return createHash('sha256').update(`TEST-ONLY:${label}:${orderId}`).digest('hex'); }
async function reserveTestAllocation(
  store: PostgresSettlementStore,
  orderId: string,
  operatorId: string,
  authorizationId: string,
  verifier: (domain: string, payload: string, signature: string) => Promise<void>,
  candidate: { allocationId: string; address: string; diversifierIndex: string; validatedAt: string; sourceNotBeforeHeight: number; state: 'AVAILABLE' },
  now = Date.now(),
) {
  const operation = await store.beginAddressAllocation(orderId, operatorId, authorizationId, candidate.diversifierIndex, verifier, now);
  candidate.allocationId = operation.allocationId;
  await store.markAddressDerivationStarted(orderId, authorizationId, operatorId, now);
  await store.recordDerivedAddress(orderId, authorizationId, operatorId, candidate.address, candidate.diversifierIndex, now);
  return store.reserveDerivedAddress(orderId, operatorId, authorizationId, candidate, now);
}

function allocationRpc(address: string, index: string, behavior: { derive?: () => void; fail?: Error; wrongIndex?: string } = {}): RpcCall {
  return async <T>(method: string) => {
    if (method === 'getblockchaininfo') return { chain: 'test', blocks: 500, headers: 500, initialblockdownload: false } as T;
    if (method === 'getwalletinfo') return { walletname: 'default', private_keys_enabled: true, scanning: false, enhanced_through: 500, unlocked_until: 0 } as T;
    if (method === 'z_listtransactions') return [] as T;
    if (method === 'getaddressinfo') return { address, ismine: true, isvalid_orchard: true, receiver_types: ['orchard'], receivers_consistent: true, diversifier_index: index } as T;
    if (method === 'z_getaddressforaccount') {
      behavior.derive?.(); if (behavior.fail) throw behavior.fail;
      return { account: 0, address, diversifier_index: behavior.wrongIndex ?? index, receiver_types: ['orchard'] } as T;
    }
    throw new Error(`Unexpected RPC method ${method}`);
  };
}

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
  await assert.rejects(settlements.beginAddressAllocation(request.id, 'wrong-operator', authorizationId, candidate.diversifierIndex, verifyAuthorization), /Operator identity/);
  const authorization = await pool.query<{ state: string }>('SELECT state FROM authorization_records WHERE authorization_id=$1', [authorizationId]);
  assert.equal(authorization.rows[0].state, 'ISSUED');
  await reserveTestAllocation(settlements, request.id, 'operator-integration', authorizationId, verifyAuthorization, candidate);
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
  await reserveTestAllocation(settlements, request2.id, 'operator-integration', auth2, verifyAuthorization, candidate2); await settlements.publishPaymentInstructions(request2.id, 'operator-integration');
  await assert.rejects(settlements.observeSource(request2.id, sourceTransactionId, sourceVerifier), /duplicate key|unique constraint/i);
  assert.equal((await requests.get(owner2, request2.id))?.status, 'PAYMENT_READY');

  const owner3 = randomUUID(); const request3 = await requests.create(owner3, `0x${randomBytes(20).toString('hex')}`);
  await settlements.acceptRequest(request3.id, 'operator-integration', request3.destinationRecipient, async () => 'a'.repeat(64));
  const auth3 = await settlements.issueAuthorization(request3.id, 'ADDRESS_ALLOCATION', 'operator-integration', async () => 'b'.repeat(64));
  const candidate3 = { ...candidate, allocationId: randomUUID(), address: `utest1${randomBytes(32).toString('hex')}`, diversifierIndex: (diversifierBase + 2n).toString() };
  await reserveTestAllocation(settlements, request3.id, 'operator-integration', auth3, verifyAuthorization, candidate3); await settlements.publishPaymentInstructions(request3.id, 'operator-integration');
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

test('TEST-ONLY PostgreSQL allocation bridge journals before RPC and recovers every durable transition', { skip: !databaseUrl }, async t => {
  const pool = createPostgresPool(databaseUrl); await migrateDatabase(pool);
  t.after(async () => { await pool.end().catch(() => undefined); });
  const encryption = new DataEncryption({ activeVersion: 17, keys: new Map([[17, randomBytes(32)]]) });
  const requests = new PostgresPublicOrderRequestStore(pool, encryption); const store = new PostgresSettlementStore(pool, encryption);
  const operatorId = 'allocation-integration'; const signature = 'd'.repeat(64);
  const allocationIndexBase = 10_000_000_000_000_000_000n + BigInt(`0x${randomBytes(8).toString('hex')}`) * 100n;
  const verify = async (_domain: string, _payload: string, provided: string) => { if (provided !== signature) throw new Error('forged operator authorization'); };
  const accepted = async (now = Date.now()) => {
    const owner = randomUUID(); const request = await requests.create(owner, `0x${randomBytes(20).toString('hex')}`, now);
    await store.acceptRequest(request.id, operatorId, request.destinationRecipient, async () => 'a'.repeat(64), now + 1);
    const authorizationId = await store.issueAuthorization(request.id, 'ADDRESS_ALLOCATION', operatorId, async () => signature, now + 2, 60);
    return { owner, request, authorizationId, now };
  };

  const crashPoints = ['afterJournal', 'afterRpcStart', 'afterDerivation', 'afterDerivedRecord', 'afterReservation'] as const;
  for (let number = 0; number < crashPoints.length; number += 1) {
    const scenario = await accepted(); const index = (allocationIndexBase + BigInt(number)).toString();
    const address = `utest1${randomBytes(32).toString('hex')}`; let derivations = 0;
    await assert.rejects(executePostgresAddressAllocation({
      store, orderId: scenario.request.id, authorizationId: scenario.authorizationId, operatorId, verifyAuthorization: verify,
      diversifierIndex: index, rpc: allocationRpc(address, index, { derive: () => { derivations += 1; } }),
      hooks: { [crashPoints[number]]: () => { throw new Error(`TEST-ONLY crash ${crashPoints[number]}`); } },
    }), /TEST-ONLY crash/);
    const interrupted = await store.addressAllocationOperation(scenario.request.id, scenario.authorizationId, operatorId);
    assert.equal(interrupted.diversifierIndex, index);
    const allocationId = await executePostgresAddressAllocation({
      store, orderId: scenario.request.id, authorizationId: scenario.authorizationId, operatorId, verifyAuthorization: verify,
      mode: 'RECONCILE', now: scenario.now + 120_000, rpc: allocationRpc(address, index, { derive: () => { derivations += 1; } }),
    });
    const recovered = await store.addressAllocationOperation(scenario.request.id, scenario.authorizationId, operatorId);
    assert.equal(recovered.phase, 'RESERVED'); assert.equal(recovered.allocationId, allocationId); assert.equal(recovered.diversifierIndex, index);
    assert.equal(derivations, crashPoints[number] === 'afterJournal' || crashPoints[number] === 'afterRpcStart' ? 1 : crashPoints[number] === 'afterDerivation' ? 2 : 1);
  }

  const uncertain = await accepted(); const uncertainIndex = (allocationIndexBase + 91n).toString(); const uncertainAddress = `utest1${randomBytes(32).toString('hex')}`;
  await assert.rejects(executePostgresAddressAllocation({ store, orderId: uncertain.request.id, authorizationId: uncertain.authorizationId, operatorId, verifyAuthorization: verify, diversifierIndex: uncertainIndex, rpc: allocationRpc(uncertainAddress, uncertainIndex, { fail: new Error('RPC timeout') }) }), /requires reconciliation/);
  const uncertainOperation = await store.addressAllocationOperation(uncertain.request.id, uncertain.authorizationId, operatorId);
  assert.equal(uncertainOperation.phase, 'RPC_UNCERTAIN');
  await assert.rejects(executePostgresAddressAllocation({ store, orderId: uncertain.request.id, authorizationId: uncertain.authorizationId, operatorId, verifyAuthorization: async () => { throw new Error('forged recovery authorization'); }, mode: 'RECONCILE', rpc: allocationRpc(uncertainAddress, uncertainIndex) }), /forged recovery authorization/);
  assert.equal((await store.addressAllocationOperation(uncertain.request.id, uncertain.authorizationId, operatorId)).rpcAttemptCount, uncertainOperation.rpcAttemptCount);
  await executePostgresAddressAllocation({ store, orderId: uncertain.request.id, authorizationId: uncertain.authorizationId, operatorId, verifyAuthorization: verify, mode: 'RECONCILE', rpc: allocationRpc(uncertainAddress, uncertainIndex) });

  const expiredOrder = await accepted(); const expiredIndex = (allocationIndexBase + 95n).toString(); const expiredAddress = `utest1${randomBytes(32).toString('hex')}`;
  await assert.rejects(executePostgresAddressAllocation({
    store, orderId: expiredOrder.request.id, authorizationId: expiredOrder.authorizationId, operatorId, verifyAuthorization: verify,
    diversifierIndex: expiredIndex, rpc: allocationRpc(expiredAddress, expiredIndex), hooks: { afterDerivedRecord: () => { throw new Error('TEST-ONLY wait past order expiry'); } },
  }), /wait past order expiry/);
  const afterOrderExpiry = expiredOrder.now + 31 * 60_000;
  await executePostgresAddressAllocation({ store, orderId: expiredOrder.request.id, authorizationId: expiredOrder.authorizationId, operatorId, verifyAuthorization: verify, mode: 'RECONCILE', now: afterOrderExpiry, rpc: allocationRpc(expiredAddress, expiredIndex) });
  await assert.rejects(store.publishPaymentInstructions(expiredOrder.request.id, operatorId, afterOrderExpiry), /expired before payment instructions/);
  await store.expire(expiredOrder.request.id, afterOrderExpiry);
  assert.equal((await requests.get(expiredOrder.owner, expiredOrder.request.id))?.status, 'FAILED');

  const concurrent = await accepted(); const concurrentIndex = (allocationIndexBase + 92n).toString(); const concurrentAddress = `utest1${randomBytes(32).toString('hex')}`;
  const results = await Promise.allSettled(Array.from({ length: 2 }, () => executePostgresAddressAllocation({ store, orderId: concurrent.request.id, authorizationId: concurrent.authorizationId, operatorId, verifyAuthorization: verify, diversifierIndex: concurrentIndex, rpc: allocationRpc(concurrentAddress, concurrentIndex) })));
  assert.ok(results.some(item => item.status === 'fulfilled'));
  assert.equal((await store.addressAllocationOperation(concurrent.request.id, concurrent.authorizationId, operatorId)).phase, 'RESERVED');

  const cancellable = await accepted(); const cancelIndex = (allocationIndexBase + 93n).toString();
  const cancelOperation = await store.beginAddressAllocation(cancellable.request.id, operatorId, cancellable.authorizationId, cancelIndex, verify);
  await store.cancelAddressAllocation(cancellable.request.id, cancellable.authorizationId, operatorId, verify, 'operator abandoned before RPC', cancellable.now + 120_000);
  assert.equal((await store.addressAllocationOperation(cancellable.request.id, cancellable.authorizationId, operatorId)).phase, 'CANCELLED');
  assert.equal(cancelOperation.rpcAttemptCount, 0);

  const forged = await accepted();
  await assert.rejects(store.beginAddressAllocation(forged.request.id, operatorId, forged.authorizationId, (allocationIndexBase + 94n).toString(), async () => { throw new Error('forged operator authorization'); }), /forged/);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM address_allocation_journal WHERE order_id=$1', [forged.request.id])).rows[0].count, 0);

  const raw = await pool.query<{ encrypted_derivation: Buffer; encrypted_receiver: Buffer; details: Record<string, unknown> }>(`SELECT j.encrypted_derivation,j.encrypted_receiver,a.details FROM address_allocation_journal j JOIN audit_events a ON a.order_id=j.order_id WHERE j.order_id=$1 ORDER BY a.event_id DESC LIMIT 1`, [uncertain.request.id]);
  assert.ok(!raw.rows[0].encrypted_derivation.toString().includes(uncertainIndex));
  assert.ok(!raw.rows[0].encrypted_receiver.toString().includes(uncertainAddress));
  assert.ok(!JSON.stringify(raw.rows[0].details).includes(uncertainAddress));
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
  await reserveTestAllocation(settlements, request.id, 'operator-relay-test', authorizationId, verifyAuthorization, candidate); await settlements.publishPaymentInstructions(request.id, 'operator-relay-test');
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
  await reserveTestAllocation(settlements, unresolvedRequest.id, 'operator-relay-test', unresolvedAuthorization, verifyAuthorization, unresolvedCandidate, started + 20_003); await settlements.publishPaymentInstructions(unresolvedRequest.id, 'operator-relay-test', started + 20_004);
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
