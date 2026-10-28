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
import { fixedWalletReadinessIntent } from './wallet-intent.ts';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { BaseSepoliaWalletControlVerifier, type WalletControlRpc } from './wallet-control.ts';
import { PostgresDestinationWalletControl } from './destination-wallet-control-store.ts';
import { normalizeEvmAddress } from '../src/lib/evm-address.ts';
import { PostgresSourcePaymentOperationStore, prepareWalletASigningPacket } from './zcash-signing-packet.ts';
import { PostgresBasePayoutPacketStore, prepareBasePayoutSigningPacket } from './base-payout-signing-packet.ts';
import { PostgresMetaMaskPayoutStore, type MetaMaskProvider } from './metamask-payout.ts';
import { PrivatePayoutService } from './private-payout-service.ts';
import { expectedMetaMaskPayoutConfirmation, expectedMetaMaskRecoveryConfirmation } from './metamask-payout.ts';
import type { OperatorConfig } from './operator-config.ts';

const databaseUrl = process.env.POSTGRES_TEST_URL;

test('operator pending-request inspection works with PostgreSQL writes forbidden', { skip: !databaseUrl }, async () => {
  const setup = createPostgresPool(databaseUrl);
  try { await migrateDatabase(setup); } finally { await setup.end(); }
  const url = new URL(databaseUrl!);
  url.searchParams.set('options', '-c default_transaction_read_only=on');
  const pool = createPostgresPool(url.toString());
  try {
    const encryption = new DataEncryption({ activeVersion: 1, keys: new Map([[1, randomBytes(32)]]) });
    assert.deepEqual(await new PostgresSettlementStore(pool, encryption).pendingRequests(Date.UTC(2100, 0, 1)), []);
  } finally { await pool.end(); }
});
async function ensureUser(pool: ReturnType<typeof createPostgresPool>, ownerId: string): Promise<void> {
  await pool.query(`INSERT INTO users(user_id,display_name,status,activated_at) VALUES($1,'TEST-ONLY account','ACTIVE',now()) ON CONFLICT (user_id) DO NOTHING`, [ownerId]);
}
async function createBoundRequest(store: PostgresPublicOrderRequestStore, pool: ReturnType<typeof createPostgresPool>, ownerId: string, address: string, now?: number) {
  await ensureUser(pool, ownerId); const request = await store.create(ownerId, fixedWalletReadinessIntent(address), now);
  const intent = await pool.query<{intent_id:string;recipient_fingerprint:Buffer}>('SELECT intent_id,recipient_fingerprint FROM destination_intents WHERE request_id=$1',[request.id]);
  const challengeId=randomUUID(); const issued=new Date(now ?? Date.now()); const expires=new Date(issued.getTime()+5*60_000);
  await pool.query(`INSERT INTO destination_wallet_challenges(challenge_id,intent_id,owner_user_id,session_hash,recipient_fingerprint,nonce_hash,encrypted_challenge,encryption_key_version,issued_at,expires_at,consumed_at,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$8,'VERIFIED')`,[challengeId,intent.rows[0].intent_id,ownerId,randomBytes(32),intent.rows[0].recipient_fingerprint,randomBytes(32),randomBytes(64),issued,expires]);
  await pool.query(`INSERT INTO destination_wallet_proofs(proof_id,challenge_id,intent_id,owner_user_id,recipient_fingerprint,method,signature_fingerprint,typed_data_digest,encrypted_proof,encryption_key_version,verification_status,verified_at,verified_block_number,verified_block_hash,last_checked_at)
    VALUES($1,$2,$3,$4,$5,'EIP712_EOA',$6,$7,$8,1,'VERIFIED',$9,1,$10,$9)`,[randomUUID(),challengeId,intent.rows[0].intent_id,ownerId,intent.rows[0].recipient_fingerprint,randomBytes(32),randomBytes(32),randomBytes(64),issued,randomBytes(32)]);
  return (await store.get(ownerId,request.id))!;
}
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

function allocationRpc(address: string, index: string, behavior: { derive?: () => void; fail?: Error; wrongIndex?: string; chainTime?: number } = {}): RpcCall {
  return async <T>(method: string) => {
    if (method === 'getblockchaininfo') return { chain: 'test', blocks: 500, headers: 500, initialblockdownload: false, bestblockhash: 'b'.repeat(64), time: behavior.chainTime ?? Math.floor(Date.now() / 1000), warnings: '' } as T;
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

test('TEST-ONLY wallet-control challenges are owner/session bound, expiring, single-use, concurrent-safe, and restart durable', { skip: !databaseUrl }, async t => {
  const pool=createPostgresPool(databaseUrl); await migrateDatabase(pool); t.after(async()=>pool.end());
  const encryption=new DataEncryption({activeVersion:31,keys:new Map([[31,randomBytes(32)]])});
  const requests=new PostgresPublicOrderRequestStore(pool,encryption); const account=privateKeyToAccount(`0x${'12'.repeat(32)}`);
  const owner=randomUUID(); const other=randomUUID(); await ensureUser(pool,owner); await ensureUser(pool,other);
  const request=await requests.create(owner,fixedWalletReadinessIntent(account.address));
  await assert.rejects(new PostgresSettlementStore(pool,encryption).acceptRequest(request.id,'operator-test',async()=> 'a'.repeat(64)),/valid required wallet-control proof/);
  const block={number:987654n,hash:`0x${'cd'.repeat(32)}` as Hex};
  const rpc:WalletControlRpc={chainId:async()=>84532,block:async()=>block,code:async()=> '0x',isValidSignature:async()=>false};
  const service=new PostgresDestinationWalletControl(pool,encryption,new BaseSepoliaWalletControlVerifier(rpc));
  const session={userId:owner,displayName:'Owner',csrfToken:'c'.repeat(64),passkeyCount:1,sessionToken:'a'.repeat(64)};
  const stranger={...session,userId:other,sessionToken:'b'.repeat(64)};
  await assert.rejects(service.issue(stranger,request.id,'https://zecathon.example'),/not found/);
  const superseded=await service.issue(session,request.id,'https://zecathon.example');
  const challenge=await service.issue(session,request.id,'https://zecathon.example');
  const supersededSignature=await account.signTypedData(superseded.typedData as Parameters<typeof account.signTypedData>[0]);
  await assert.rejects(service.verify(session,superseded.challengeId,supersededSignature,'https://zecathon.example'),/already used|invalid/);
  const signed=await account.signTypedData(challenge.typedData as Parameters<typeof account.signTypedData>[0]);
  const attempts=await Promise.allSettled([service.verify(session,challenge.challengeId,signed,'https://zecathon.example'),service.verify(session,challenge.challengeId,signed,'https://zecathon.example')]);
  assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1); assert.equal(attempts.filter(item=>item.status==='rejected').length,1);
  assert.equal((await requests.get(owner,request.id))?.destinationBinding.walletControlVerification,'verified-eoa');
  await assert.rejects(service.issue(session,request.id,'https://zecathon.example'),/already verified/);
  await assert.rejects(service.verify(stranger,challenge.challengeId,signed,'https://zecathon.example'),/another session|already used/);
  await assert.rejects(pool.query(`UPDATE destination_wallet_proofs SET owner_user_id=$2 WHERE intent_id=$1`,[challenge.intentId,other]),/immutable/);
  await assert.rejects(pool.query(`UPDATE destination_wallet_audit_events SET details='{}'::jsonb WHERE intent_id=$1`,[challenge.intentId]),/append-only/);
  const restartedPool=createPostgresPool(databaseUrl); const restarted=new PostgresPublicOrderRequestStore(restartedPool,encryption);
  assert.equal((await restarted.get(owner,request.id))?.destinationBinding.walletControlVerification,'verified-eoa'); await restartedPool.end();

  const reuseRequest=await requests.create(other,fixedWalletReadinessIntent(account.address)); const reuseChallenge=await service.issue(stranger,reuseRequest.id,'https://zecathon.example');
  await assert.rejects(service.verify(stranger,reuseChallenge.challengeId,signed,'https://zecathon.example'),/does not match|invalid/);

  const expiringAccount=privateKeyToAccount(`0x${'13'.repeat(32)}`); const expiringOwner=randomUUID(); await ensureUser(pool,expiringOwner);
  const expiringRequest=await requests.create(expiringOwner,fixedWalletReadinessIntent(expiringAccount.address),Date.now());
  const expiringSession={...session,userId:expiringOwner,sessionToken:'d'.repeat(64)}; const expired=await service.issue(expiringSession,expiringRequest.id,'https://zecathon.example',Date.now());
  const expiredSignature=await expiringAccount.signTypedData(expired.typedData as Parameters<typeof expiringAccount.signTypedData>[0]);
  await assert.rejects(service.verify(expiringSession,expired.challengeId,expiredSignature,'https://zecathon.example',Date.now()+6*60_000),/expired/);
});

test('TEST-ONLY ERC-1271 proof validity changes block acceptance and become durable audit state', { skip: !databaseUrl }, async t => {
  const pool=createPostgresPool(databaseUrl); await migrateDatabase(pool); t.after(async()=>pool.end());
  const encryption=new DataEncryption({activeVersion:32,keys:new Map([[32,randomBytes(32)]])}); const requests=new PostgresPublicOrderRequestStore(pool,encryption);
  const owner=randomUUID(); await ensureUser(pool,owner); const contract=`0x${'77'.repeat(20)}`; const request=await requests.create(owner,fixedWalletReadinessIntent(contract));
  const block={number:777n,hash:`0x${'de'.repeat(32)}` as Hex}; let valid=true;
  const rpc:WalletControlRpc={chainId:async()=>84532,block:async()=>block,code:async()=> '0x01',isValidSignature:async()=>valid};
  const verifier=new BaseSepoliaWalletControlVerifier(rpc,{allowContractWallets:true}); const service=new PostgresDestinationWalletControl(pool,encryption,verifier);
  const session={userId:owner,displayName:'Contract owner',csrfToken:'e'.repeat(64),passkeyCount:1,sessionToken:'f'.repeat(64)};
  const challenge=await service.issue(session,request.id,'https://zecathon.example'); await service.verify(session,challenge.challengeId,'0x1234','https://zecathon.example');
  const disabledStore=new PostgresSettlementStore(pool,encryption,new BaseSepoliaWalletControlVerifier(rpc));
  assert.equal((await disabledStore.pendingRequests()).some(item=>item.requestId===request.id),false);
  await assert.rejects(disabledStore.acceptRequest(request.id,'operator-eoa-only',async()=> 'a'.repeat(64)),/disabled/);
  valid=false; await assert.rejects(new PostgresSettlementStore(pool,encryption,verifier).acceptRequest(request.id,'operator-1271',async()=> 'a'.repeat(64)),/no longer valid/);
  const state=await pool.query<{verification_status:string}>('SELECT verification_status FROM destination_wallet_proofs WHERE intent_id=$1',[challenge.intentId]);
  assert.equal(state.rows[0].verification_status,'RECHECK_FAILED');
  const audit=await pool.query<{event_type:string;details:Record<string,string>}>('SELECT event_type,details FROM destination_wallet_audit_events WHERE intent_id=$1 ORDER BY event_id DESC LIMIT 1',[challenge.intentId]);
  assert.equal(audit.rows[0].event_type,'PROOF_RECHECK_FAILED'); assert.equal(audit.rows[0].details.checkpoint,'operator-acceptance');
});

test('PostgreSQL migration, concurrent request idempotency, restart persistence, and immutable audit constraints', { skip: !databaseUrl }, async () => {
  const firstPool = createPostgresPool(databaseUrl);
  await migrateDatabase(firstPool);
  const encryption = new DataEncryption({ activeVersion: 1, keys: new Map([[1, randomBytes(32)]]) });
  const firstStore = new PostgresPublicOrderRequestStore(firstPool, encryption);
  const owner = randomUUID(); const recipient = `0x${'4'.repeat(40)}`;
  await ensureUser(firstPool, owner);
  const attempts = await Promise.all(Array.from({ length: 8 }, () => firstStore.create(owner, fixedWalletReadinessIntent(recipient))));
  assert.equal(new Set(attempts.map(item => item.id)).size, 1);
  const id = attempts[0].id;
  await firstPool.end();

  const restartedPool = createPostgresPool(databaseUrl);
  const restartedStore = new PostgresPublicOrderRequestStore(restartedPool, encryption);
  assert.equal((await restartedStore.get(owner, id))?.destinationBinding.status, 'confirmed');
  assert.equal((await restartedStore.get(owner, id))?.destinationReview?.recipient.toLowerCase(), recipient.toLowerCase(), 'the owner can recover the exact reviewed recipient after restart');

  const orderId = randomUUID(); const now = new Date(); const later = new Date(now.getTime() + 3_600_000);
  await restartedPool.query(`INSERT INTO orders
    (order_id, owner_session_hash, immutable_manifest, manifest_signature, accepted_by, public_view, encrypted_private_state, encryption_key_version, status, created_at, expires_at, updated_at)
    VALUES ($1,$2,$3,$4,'integration-test',$5,$6,1,'CREATED',$7,$8,$7)`, [orderId, createHash('sha256').update(owner).digest(), { exact: true }, Buffer.alloc(32), { id: orderId }, Buffer.from('encrypted-fixture'), now, later]);
  await assert.rejects(restartedPool.query(`UPDATE orders SET immutable_manifest = $2, state_version = 1, updated_at = now() WHERE order_id = $1`, [orderId, { exact: false }]), /immutable order fields/);
  const audit = await restartedPool.query<{ event_id: string }>(`INSERT INTO audit_events(order_id, actor_type, event_type) VALUES ($1,'SYSTEM','TEST') RETURNING event_id`, [orderId]);
  await assert.rejects(restartedPool.query(`UPDATE audit_events SET event_type = 'ALTERED' WHERE event_id = $1`, [audit.rows[0].event_id]), /append-only/);
  await restartedPool.end();
});

test('TEST-ONLY two accounts retain distinct immutable encrypted destinations across conflicts and restart', { skip: !databaseUrl }, async t => {
  const pool = createPostgresPool(databaseUrl); await migrateDatabase(pool); t.after(() => pool.end());
  const encryption = new DataEncryption({ activeVersion: 23, keys: new Map([[23, randomBytes(32)]]) });
  const store = new PostgresPublicOrderRequestStore(pool, encryption); const settlements = new PostgresSettlementStore(pool, encryption);
  const ownerA = randomUUID(); const ownerB = randomUUID(); const addressA = `0x${'a'.repeat(40)}`; const addressB = `0x${'b'.repeat(40)}`;
  const requestA = await createBoundRequest(store, pool, ownerA, addressA); const requestB = await createBoundRequest(store, pool, ownerB, addressB);
  assert.notEqual(requestA.id, requestB.id); assert.equal(await store.get(ownerB, requestA.id), undefined); assert.equal(await store.get(ownerA, requestB.id), undefined);
  assert.equal((await store.create(ownerA, fixedWalletReadinessIntent(addressA))).id, requestA.id, 'same owner and intent is idempotent');
  await assert.rejects(store.create(ownerA, fixedWalletReadinessIntent(addressB)), /different immutable destination intent/);
  await assert.rejects(pool.query(`UPDATE destination_intents SET owner_user_id=$2 WHERE request_id=$1`, [requestA.id, ownerB]), /immutable|foreign key/i);
  const privateRows = await pool.query<{ encrypted_intent: Buffer }>('SELECT encrypted_intent FROM destination_intents WHERE request_id = ANY($1::uuid[])', [[requestA.id, requestB.id]]);
  assert.equal(privateRows.rows.length, 2); assert.ok(privateRows.rows.every(row => !row.encrypted_intent.toString().includes(addressA) && !row.encrypted_intent.toString().includes(addressB)));
  await settlements.acceptRequest(requestA.id, 'operator-binding-test', async binding => {
    assert.equal(binding.destinationRecipient.toLowerCase(), addressA); assert.equal(binding.version, 2); assert.equal(binding.destinationIntent?.walletControlVerification, 'verified-eip712-eoa'); return 'a'.repeat(64);
  });
  await assert.rejects(pool.query(`UPDATE public_order_requests SET owner_user_id=$2 WHERE request_id=$1`, [requestA.id, ownerB]), /foreign key|constraint/i);
  assert.equal((await store.get(ownerA, requestA.id))?.paymentInstructions, undefined, 'acceptance alone cannot publish a payment receiver');
  assert.equal((await store.get(ownerA, requestA.id))?.destinationReview?.recipient.toLowerCase(), addressA, 'the exact recipient is decrypted only into the owner-scoped review response');
  const restartedPool = createPostgresPool(databaseUrl); const restarted = new PostgresPublicOrderRequestStore(restartedPool, encryption);
  assert.equal((await restarted.get(ownerA, requestA.id))?.destinationBinding.status, 'bound'); await restartedPool.end();
});

test('TEST-ONLY accepted unallocated expiry is atomic, guarded, idempotent, owner-visible, and audit-preserving', { skip: !databaseUrl }, async t => {
  const pool = createPostgresPool(databaseUrl); await migrateDatabase(pool); t.after(async () => pool.end());
  const encryption = new DataEncryption({ activeVersion: 41, keys: new Map([[41, randomBytes(32)]]) });
  const requests = new PostgresPublicOrderRequestStore(pool, encryption);
  const settlements = new PostgresSettlementStore(pool, encryption, undefined, { shieldedPaymentWindowMs: 45 * 60_000 });
  const operatorId = 'accepted-expiry-integration'; const acceptedAt = Date.now();

  const owner = randomUUID(); const request = await createBoundRequest(requests, pool, owner, `0x${randomBytes(20).toString('hex')}`, acceptedAt);
  await settlements.acceptRequest(request.id, operatorId, async () => 'a'.repeat(64), acceptedAt + 1);
  const acceptedView = await requests.get(owner, request.id, acceptedAt + 2);
  assert.equal(acceptedView?.expiresAt, request.expiresAt, 'acceptance does not rewrite the request/quote expiry');
  assert.equal(acceptedView?.paymentDeadline, new Date(acceptedAt + 1 + 45 * 60_000).toISOString());
  const before = await pool.query<{ immutable_manifest: Record<string, unknown>; expires_at: Date; state_version: string; count: string }>(`SELECT o.immutable_manifest,o.expires_at,o.state_version,count(a.event_id)::text AS count
    FROM orders o JOIN audit_events a ON a.order_id=o.order_id WHERE o.order_id=$1 GROUP BY o.order_id`, [request.id]);
  const paymentDeadline = Date.parse(acceptedView!.paymentDeadline!);
  await assert.rejects(pool.query(`UPDATE orders SET expires_at=expires_at+interval '1 minute',state_version=state_version+1 WHERE order_id=$1`, [request.id]), /immutable order fields/);
  await assert.rejects(settlements.expire(request.id, paymentDeadline - 1), /not expired/);
  assert.equal((await requests.get(owner, request.id, paymentDeadline - 1))?.status, 'ACCEPTED');

  const expiredAt = paymentDeadline + 1;
  await settlements.expire(request.id, expiredAt);
  const ownerView = await requests.get(owner, request.id, expiredAt);
  assert.equal(ownerView?.status, 'EXPIRED');
  assert.equal(ownerView?.order?.status, 'EXPIRED');
  assert.equal(ownerView?.order?.resolutionReason, 'accepted-unallocated-expired');
  assert.equal(ownerView?.paymentInstructions, undefined);
  assert.match(ownerView?.timeline?.at(-1)?.type ?? '', /ORDER_EXPIRED/);

  const after = await pool.query<{ status: string; immutable_manifest: Record<string, unknown>; public_view: Record<string, unknown>; encrypted_private_state: Buffer; expires_at: Date; state_version: string; count: string }>(`SELECT o.status,o.immutable_manifest,o.public_view,o.encrypted_private_state,o.expires_at,o.state_version,count(a.event_id)::text AS count
    FROM orders o JOIN audit_events a ON a.order_id=o.order_id WHERE o.order_id=$1 GROUP BY o.order_id`, [request.id]);
  assert.equal(after.rows[0].status, 'EXPIRED');
  assert.deepEqual(after.rows[0].immutable_manifest, before.rows[0].immutable_manifest);
  assert.equal(new Date(after.rows[0].expires_at).toISOString(), before.rows[0].expires_at.toISOString());
  assert.equal(Number(after.rows[0].state_version), Number(before.rows[0].state_version) + 1);
  assert.equal(Number(after.rows[0].count), Number(before.rows[0].count) + 1);
  assert.deepEqual(encryption.decrypt<Record<string, unknown>>(after.rows[0].encrypted_private_state, `order:${request.id}:private-state`), {
    phase: 'EXPIRED', requestId: request.id, binding: (after.rows[0].immutable_manifest as { binding: unknown }).binding,
    operatorId, status: 'EXPIRED', expiredAt: new Date(expiredAt).toISOString(), resolutionReason: 'accepted-unallocated-expired',
  });

  await settlements.expire(request.id, expiredAt + 5_000);
  const retried = await pool.query<{ state_version: string; count: string }>(`SELECT o.state_version,count(a.event_id)::text AS count FROM orders o JOIN audit_events a ON a.order_id=o.order_id WHERE o.order_id=$1 GROUP BY o.order_id`, [request.id]);
  assert.equal(retried.rows[0].state_version, after.rows[0].state_version);
  assert.equal(retried.rows[0].count, after.rows[0].count);

  const conflictOwner = randomUUID(); const conflict = await createBoundRequest(requests, pool, conflictOwner, `0x${randomBytes(20).toString('hex')}`, acceptedAt + 10_000);
  await settlements.acceptRequest(conflict.id, operatorId, async () => 'b'.repeat(64), acceptedAt + 10_001);
  const authorizationId = await settlements.issueAuthorization(conflict.id, 'ADDRESS_ALLOCATION', operatorId, async () => 'c'.repeat(64), acceptedAt + 10_002, 60);
  const conflictDiversifier = (41_000_000_000_000_000_000n + BigInt(`0x${randomBytes(8).toString('hex')}`)).toString();
  await settlements.beginAddressAllocation(conflict.id, operatorId, authorizationId, conflictDiversifier, async () => undefined, acceptedAt + 10_003);
  const conflictDeadline = Date.parse((await requests.get(conflictOwner, conflict.id))!.paymentDeadline!);
  await assert.rejects(settlements.expire(conflict.id, conflictDeadline + 1), /allocated or in-flight receiver/);
  assert.equal((await requests.get(conflictOwner, conflict.id, conflictDeadline + 1))?.status, 'ACCEPTED');
  assert.equal((await pool.query<{ status: string }>('SELECT status FROM orders WHERE order_id=$1', [conflict.id])).rows[0].status, 'CREATED');

  const fundedOwner = randomUUID(); const funded = await createBoundRequest(requests, pool, fundedOwner, `0x${randomBytes(20).toString('hex')}`, acceptedAt + 20_000);
  await settlements.acceptRequest(funded.id, operatorId, async () => 'd'.repeat(64), acceptedAt + 20_001);
  await pool.query(`INSERT INTO settlement_evidence(evidence_id,order_id,chain,reference_fingerprint,encrypted_evidence,encryption_key_version,independently_verified_at)
    VALUES($1,$2,'zcash-testnet',$3,$4,$5,$6)`, [randomUUID(), funded.id, randomBytes(32), randomBytes(64), encryption.activeVersion, new Date(acceptedAt + 20_002)]);
  const fundedDeadline = Date.parse((await requests.get(fundedOwner, funded.id))!.paymentDeadline!);
  await assert.rejects(settlements.expire(funded.id, fundedDeadline + 1), /source-payment evidence/);
  assert.equal((await requests.get(fundedOwner, funded.id, fundedDeadline + 1))?.status, 'ACCEPTED');
  assert.equal((await pool.query<{ status: string }>('SELECT status FROM orders WHERE order_id=$1', [funded.id])).rows[0].status, 'CREATED');
});

test('TEST-ONLY production lifecycle is concurrent-safe, encrypted, owner-scoped, recoverable, and rollback-safe', { skip: !databaseUrl }, async t => {
  const pool = createPostgresPool(databaseUrl); await migrateDatabase(pool);
  t.after(async () => { await pool.end().catch(() => undefined); });
  const encryption = new DataEncryption({ activeVersion: 7, keys: new Map([[7, randomBytes(32)]]) });
  const requests = new PostgresPublicOrderRequestStore(pool, encryption); const settlements = new PostgresSettlementStore(pool, encryption);
  const owner = randomUUID(); const stranger = randomUUID(); const recipient = `0x${randomBytes(20).toString('hex')}`;
  const request = await createBoundRequest(requests, pool, owner, recipient);
  const accepted = await Promise.allSettled(Array.from({ length: 6 }, () => settlements.acceptRequest(request.id, 'operator-integration', async () => 'a'.repeat(64))));
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
  assert.equal(ownerView?.paymentInstructions?.receiver, candidate.address); assert.equal(ownerView?.destinationReview?.recipient, normalizeEvmAddress(recipient)); assert.equal(strangerView, undefined);
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

  const owner2 = randomUUID(); const request2 = await createBoundRequest(requests, pool, owner2, `0x${randomBytes(20).toString('hex')}`);
  await settlements.acceptRequest(request2.id, 'operator-integration', async () => 'a'.repeat(64));
  const auth2 = await settlements.issueAuthorization(request2.id, 'ADDRESS_ALLOCATION', 'operator-integration', async () => 'b'.repeat(64));
  const candidate2 = { ...candidate, allocationId: randomUUID(), address: `utest1${randomBytes(32).toString('hex')}`, diversifierIndex: (diversifierBase + 1n).toString() };
  await reserveTestAllocation(settlements, request2.id, 'operator-integration', auth2, verifyAuthorization, candidate2); await settlements.publishPaymentInstructions(request2.id, 'operator-integration');
  await assert.rejects(settlements.observeSource(request2.id, sourceTransactionId, sourceVerifier), /duplicate key|unique constraint/i);
  assert.equal((await requests.get(owner2, request2.id))?.status, 'PAYMENT_READY');

  const owner3 = randomUUID(); const request3 = await createBoundRequest(requests, pool, owner3, `0x${randomBytes(20).toString('hex')}`);
  await settlements.acceptRequest(request3.id, 'operator-integration', async () => 'a'.repeat(64));
  const auth3 = await settlements.issueAuthorization(request3.id, 'ADDRESS_ALLOCATION', 'operator-integration', async () => 'b'.repeat(64));
  const candidate3 = { ...candidate, allocationId: randomUUID(), address: `utest1${randomBytes(32).toString('hex')}`, diversifierIndex: (diversifierBase + 2n).toString() };
  await reserveTestAllocation(settlements, request3.id, 'operator-integration', auth3, verifyAuthorization, candidate3); await settlements.publishPaymentInstructions(request3.id, 'operator-integration');
  const preparedOrder=await settlements.sourcePaymentOrder(request3.id);assert.equal(preparedOrder.sourceReceiver,candidate3.address);assert.equal(preparedOrder.sourceAmountZat,'1000000');
  const sourcePacket=prepareWalletASigningPacket(preparedOrder,{network:'zcash-testnet',synchronized:true,historyComplete:true,locked:true,walletOwned:true,walletName:'TEST-ONLY-wallet-a',blocks:600,account:0,minimumConfirmations:10,confirmedZatoshis:'98465000',aggregateConfirmedZatoshis:'98465000',ironwoodUsableZatoshis:'98465000',poolZatoshis:{ironwood:'98465000',orchard:'0'},requiredZatoshis:'1010000',sufficientForPaymentAndFeeReserve:true,fullPrivacyCompatible:true});
  const sourceOperations=new PostgresSourcePaymentOperationStore(pool,encryption);const sourceOperationId=await sourceOperations.prepare(sourcePacket);await sourceOperations.beginSubmission(sourceOperationId,sourcePacket.packetDigest);await sourceOperations.markSubmissionAmbiguous(sourceOperationId,'TEST-ONLY lost zecd response');await sourceOperations.requireRecovery(sourceOperationId,'TEST-ONLY exact operation requires manual recovery');await assert.rejects(sourceOperations.beginSubmission(sourceOperationId,sourcePacket.packetDigest),/one-time/);
  const restartedSourcePool=createPostgresPool(databaseUrl);const restartedSourceOperations=new PostgresSourcePaymentOperationStore(restartedSourcePool,encryption);assert.equal((await restartedSourceOperations.load(sourceOperationId)).state,'RECOVERY_REQUIRED');await assert.rejects(restartedSourceOperations.beginSubmission(sourceOperationId,sourcePacket.packetDigest),/one-time/);await restartedSourcePool.end();
  await settlements.observeSource(request3.id, testOnlyTransaction('source-complete', request3.id), sourceVerifier); await settlements.queuePayout(request3.id, 'operator-integration');
  const payoutAuth = await settlements.issueAuthorization(request3.id, 'PAYOUT', 'operator-integration', async () => 'b'.repeat(64));
  await settlements.approvePayout(request3.id, 'operator-integration', payoutAuth, verifyAuthorization);
  await assert.rejects(settlements.payoutPacketOrder(request3.id,randomUUID()),/exact approved payout authorization/);const approvedOrder=await settlements.payoutPacketOrder(request3.id,payoutAuth);assert.equal(approvedOrder.destinationAmountAtomic,'1000000');
  const payoutPackets=new PostgresBasePayoutPacketStore(pool);const lpSender=normalizeEvmAddress(`0x${'ab'.repeat(20)}`);const operatorConfig:OperatorConfig={version:1,network:'base-sepolia',chainId:84532,lpSender,usdcReceiver:normalizeEvmAddress(`0x${'cd'.repeat(20)}`),confirmedAt:new Date().toISOString(),confirmationSource:'interactive-metamask'};const payoutPacket=prepareBasePayoutSigningPacket({order:approvedOrder,operatorConfig,authorizationId:payoutAuth,nonce:7,gasLimit:'65000',maxFeePerGas:'2000000000',maxPriorityFeePerGas:'1000000000'});await payoutPackets.prepare(payoutPacket);assert.deepEqual(await payoutPackets.load(payoutPacket.packetId),payoutPacket);await assert.rejects(payoutPackets.prepare(payoutPacket),/duplicate key|unique constraint/i);
  const metaProvider:MetaMaskProvider={async request(input){if(input.method==='eth_chainId')return '0x14a34';if(input.method==='eth_accounts')return [lpSender];if(input.method==='eth_getTransactionCount')return '0x7';if(input.method==='eth_getBlockByNumber')return {baseFeePerGas:'0x3b9aca00'};if(input.method==='eth_estimateGas')return '0xea60';if(input.method==='eth_getBalance')return '0xde0b6b3a7640000';if(input.method==='eth_call')return '0x989680';throw new Error(`unexpected ${input.method}`);}};
  const payoutTx = `0x${testOnlyTransaction('destination-complete', request3.id)}` as Hex;
  const observations:Record<string,unknown>={eth_chainId:'0x14a34',eth_accounts:[lpSender],'eth_getTransactionCount:latest':'0x7','eth_getTransactionCount:pending':'0x7',eth_getBlockByNumber:{baseFeePerGas:'0x3b9aca00'},eth_estimateGas:'0xea60',eth_getBalance:'0xde0b6b3a7640000',eth_call:'0x989680'};
  let mismatch=false,sourceReorg=false,baseReorg=false;
  const rpc:RpcCall=async<T>(method:string,params?:unknown[])=>{
    if(method==='eth_getTransactionByHash')return {blockHash:`0x${'77'.repeat(32)}`,blockNumber:'0x64',hash:payoutTx,from:payoutPacket.sender,to:payoutPacket.tokenContract,chainId:'0x14a34',nonce:'0x7',value:'0x0',input:payoutPacket.calldata,gas:'0xfde8',maxFeePerGas:'0x77359400',maxPriorityFeePerGas:'0x3b9aca00'} as T;
    if(method==='eth_getTransactionReceipt')return {status:'0x1',transactionHash:payoutTx,blockHash:`0x${'77'.repeat(32)}`,blockNumber:'0x64',logs:[{address:BASE_USDC,transactionHash:payoutTx,blockHash:`0x${'77'.repeat(32)}`,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',`0x${payoutPacket.sender.slice(2).toLowerCase().padStart(64,'0')}`,`0x${payoutPacket.recipient.slice(2).toLowerCase().padStart(64,'0')}`],data:`0x${BigInt(payoutPacket.amountAtomic).toString(16).padStart(64,'0')}`}]} as T;
    if(method==='eth_blockNumber')return '0x66' as T;
    if(method==='eth_getBlockByNumber'&&params?.[0]==='0x64')return {hash:`0x${(baseReorg?'88':'77').repeat(32)}`,number:'0x64',transactions:[payoutTx]} as T;
    if(method==='eth_getBalance'&&mismatch)return '0x1' as T;
    return await metaProvider.request({method,params}) as T;
  };
  const controls={verifyOperatorPayload:verifyAuthorization,signReceipt:async()=> 'f'.repeat(64),verifyReceipt:async(_value:string,signature:string)=>{assert.equal(signature,'f'.repeat(64));}};
  const makeService=(servicePool:typeof pool,approvedPacketId:string|undefined=payoutPacket.packetId)=>new PrivatePayoutService({pool:servicePool,settlements:new PostgresSettlementStore(servicePool,encryption),controls,operatorId:'operator-integration',lpSender,rpc,approvedPacketId,sourceVerifier:async input=>{const evidence=await sourceVerifier(input);return {...evidence,blockHash:sourceReorg?'d'.repeat(64):evidence.blockHash};}});
  const service=makeService(pool);
  await assert.rejects(makeService(pool,'').begin(payoutPacket.packetId,observations,expectedMetaMaskPayoutConfirmation(payoutPacket)),/disabled/);
  mismatch=true;await assert.rejects(service.rehearse(payoutPacket.packetId,observations),/balance|disagree/);mismatch=false;
  const rehearsal=await service.rehearse(payoutPacket.packetId,observations);
  await service.rehearse(payoutPacket.packetId,observations); // Immutable rehearsal is reusable until submission starts.
  const metaStore=new PostgresMetaMaskPayoutStore(pool);
  await assert.rejects(metaStore.recordRehearsal(rehearsal),/duplicate|already rehearsed/i);
  sourceReorg=true;await assert.rejects(service.begin(payoutPacket.packetId,observations,expectedMetaMaskPayoutConfirmation(payoutPacket)),/Source canonical/);sourceReorg=false;
  const wrongOperator=new PostgresMetaMaskPayoutStore(pool,async(client,_id,now)=>{const version=await settlements.checkPayoutSource(request3.id,sourceVerifier);await settlements.validatePayoutSubmission(client,payoutPacket,'wrong-operator',verifyAuthorization,version,now);});
  await assert.rejects(wrongOperator.beginSubmission(payoutPacket.packetId,rehearsal.requestDigest),/approved order|identity/i);
  assert.equal((await service.preview(payoutPacket.packetId)).journal.submission_state,'REHEARSED');
  const attempts=await Promise.allSettled([service.begin(payoutPacket.packetId,observations,expectedMetaMaskPayoutConfirmation(payoutPacket)),service.begin(payoutPacket.packetId,observations,expectedMetaMaskPayoutConfirmation(payoutPacket))]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal(attempts.filter(x=>x.status==='rejected').length,1);
  assert.equal((await service.preview(payoutPacket.packetId)).journal.packet_state,'RECOVERY_REQUIRED');
  // Real PostgreSQL trigger simulates order persistence failure after both hash journals commit.
  await pool.query(`CREATE OR REPLACE FUNCTION test_only_payout_write_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST-ONLY order write failed'; END $$`);
  await pool.query(`CREATE TRIGGER test_only_payout_write_failure BEFORE UPDATE ON orders FOR EACH ROW WHEN (NEW.order_id='${request3.id}'::uuid AND NEW.status='PAYOUT_SUBMITTED') EXECUTE FUNCTION test_only_payout_write_failure()`);
  try { await assert.rejects(service.capture(payoutPacket.packetId,payoutTx),/TEST-ONLY order write failed/); }
  finally { await pool.query('DROP TRIGGER test_only_payout_write_failure ON orders');await pool.query('DROP FUNCTION test_only_payout_write_failure()'); }
  assert.equal((await service.preview(payoutPacket.packetId)).journal.transaction_hash,payoutTx.slice(2));
  assert.equal((await service.preview(payoutPacket.packetId)).progress.status,'PAYOUT_AWAITING_APPROVAL');
  const restartedSubmissionPool=createPostgresPool(databaseUrl),restartedMetaStore=new PostgresMetaMaskPayoutStore(restartedSubmissionPool),restartedService=makeService(restartedSubmissionPool);
  try {
    await restartedService.recover(payoutPacket.packetId,payoutTx,expectedMetaMaskRecoveryConfirmation(payoutPacket,payoutTx));
    await restartedService.recover(payoutPacket.packetId,payoutTx,expectedMetaMaskRecoveryConfirmation(payoutPacket,payoutTx));
    await assert.rejects(restartedMetaStore.recordTransactionHash(payoutPacket.packetId,`0x${'ee'.repeat(32)}`),/conflicting/);
    await assert.rejects(restartedMetaStore.beginSubmission(payoutPacket.packetId,rehearsal.requestDigest,Date.parse(payoutPacket.expiresAt)+1),/one-time/);
    await restartedMetaStore.requireRecovery(payoutPacket.packetId,'TEST-ONLY canonical receipt reorg');
    await restartedMetaStore.recordTransactionHash(payoutPacket.packetId,payoutTx,Date.parse(payoutPacket.expiresAt)+60_000);
  } finally { await restartedSubmissionPool.end(); }
  await settlements.recordPayout(request3.id,'operator-integration',payoutTx);
  await assert.rejects(settlements.verifyPayout(request3.id,async()=> 'f'.repeat(64),async()=>{throw new Error('TEST-ONLY wrong LP sender');}),/wrong LP sender/);
  sourceReorg=true;await assert.rejects(service.finish(payoutPacket.packetId),/Source canonical/);sourceReorg=false;
  baseReorg=true;await assert.rejects(service.finish(payoutPacket.packetId),/not canonical/);baseReorg=false;
  assert.equal((await requests.get(owner3,request3.id))?.status,'PAYOUT_SUBMITTED');
  const {receiptId}=await service.finish(payoutPacket.packetId);
  assert.equal((await service.finish(payoutPacket.packetId)).receiptId,receiptId);
  await metaStore.markConfirmed(payoutPacket.packetId,payoutTx);
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
    const owner = randomUUID(); const request = await createBoundRequest(requests, pool, owner, `0x${randomBytes(20).toString('hex')}`, now);
    await store.acceptRequest(request.id, operatorId, async () => 'a'.repeat(64), now + 1);
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
  await executePostgresAddressAllocation({ store, orderId: expiredOrder.request.id, authorizationId: expiredOrder.authorizationId, operatorId, verifyAuthorization: verify, mode: 'RECONCILE', now: afterOrderExpiry, rpc: allocationRpc(expiredAddress, expiredIndex, { chainTime: Math.floor(afterOrderExpiry / 1000) }) });
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
  const owner = randomUUID(); const request = await createBoundRequest(requests, pool, owner, `0x${randomBytes(20).toString('hex')}`);
  await settlements.acceptRequest(request.id, 'operator-relay-test', async () => 'a'.repeat(64));
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

  const unresolvedOwner = randomUUID(); const unresolvedRequest = await createBoundRequest(requests, pool, unresolvedOwner, `0x${randomBytes(20).toString('hex')}`, started + 20_000);
  await settlements.acceptRequest(unresolvedRequest.id, 'operator-relay-test', async () => 'a'.repeat(64), started + 20_001);
  const unresolvedAuthorization = await settlements.issueAuthorization(unresolvedRequest.id, 'ADDRESS_ALLOCATION', 'operator-relay-test', async () => 'b'.repeat(64), started + 20_002);
  const unresolvedCandidate = { ...candidate, allocationId: randomUUID(), address: `utest1${randomBytes(32).toString('hex')}`, diversifierIndex: (BigInt(relayDiversifier) + 1n).toString() };
  await reserveTestAllocation(settlements, unresolvedRequest.id, 'operator-relay-test', unresolvedAuthorization, verifyAuthorization, unresolvedCandidate, started + 20_003); await settlements.publishPaymentInstructions(unresolvedRequest.id, 'operator-relay-test', started + 20_004);
  const unresolvedTx = testOnlyTransaction('relay-unresolved', unresolvedRequest.id); const unresolvedJob = await relay.createSourceJob({ orderId: unresolvedRequest.id, transactionId: unresolvedTx, phase: 'SOURCE_DETECTION', verifierId }, started + 21_000);
  const unresolvedChallenge = await relay.claim(verifierId, started + 22_000); assert.ok(unresolvedChallenge);
  const unresolvedPayload: RelayEvidencePayload = { version: 1, jobId: unresolvedJob, verifierId, phase: 'SOURCE_DETECTION', nonce: unresolvedChallenge.payload.nonce, orderId: unresolvedRequest.id, manifestFingerprint: unresolvedChallenge.payload.manifestFingerprint, requestFingerprint: relayFingerprint(unresolvedChallenge.payload.request), observedAt: new Date(started + 23_000).toISOString(), expiresAt: new Date(started + 60_000).toISOString(), outcome: 'UNRESOLVED', reasonCode: 'REORG_DETECTED' };
  assert.equal(await relay.submit(signRelayEvidence(unresolvedPayload, verifier.privateKey), started + 24_000), 'UNRESOLVED');
  await settlements.applyRelayUnresolved(unresolvedJob, await relay.verifiedMessage(unresolvedJob, coordinator.publicKey, started + 25_000), started + 25_000);
  assert.equal((await requests.get(unresolvedOwner, unresolvedRequest.id))?.status, 'UNRESOLVED');
  await assert.rejects(settlements.applyRelayUnresolved(unresolvedJob, signRelayEvidence(unresolvedPayload, verifier.privateKey), started + 25_001), /not unresolved/);
  const raw = await pool.query<{ encrypted_envelope: Buffer }>('SELECT encrypted_envelope FROM private_verification_messages WHERE job_id=$1', [confirmationJob]);
  assert.ok(!raw.rows[0].encrypted_envelope.toString().includes(candidate.address));
});
