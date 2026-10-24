import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  activateOrder, attachDestinationEvidence, attachSourceEvidence, authorizePayout, completeOrder,
  confirmSourceEvidence, createOrder, expireOrder, markUnresolved, queuePayoutApproval,
  recordPayoutSubmission, type DestinationReceiptLink, type PaymentOrder, type SourceReceiptLink,
} from '../src/lib/order-coordinator.ts';
import { createOperatorOrderBinding, validateOperatorOrderBinding, type OperatorOrderBinding } from '../src/lib/operator-order.ts';
import { createFinalReceipt, toShareableReceipt, type FinalReceipt, type ShareableReceipt } from '../src/lib/receipt.ts';
import { verifyBaseSepoliaErc20Receipt, verifyZcashShieldedReceipt } from '../src/lib/read-only-verification.ts';
import { verifyBaseSepoliaTransaction, type BaseVerificationRequest } from './base-sepolia-verifier.ts';
import { DataEncryption } from './data-encryption.ts';
import { PUBLIC_ROUTE_TERMS } from './public-order-store.ts';
import { verifyZcashTransaction, type ZcashVerificationRequest } from './zcash-verifier.ts';
import type { ValidatedReceivingAddress } from './zcash-address-allocator.ts';
import { isDeepStrictEqual } from 'node:util';
import { relayFingerprint, type SignedRelayEvidence } from './private-verification-protocol.ts';

type SourceVerifier = (request: ZcashVerificationRequest) => ReturnType<typeof verifyZcashTransaction>;
type DestinationVerifier = (request: BaseVerificationRequest) => ReturnType<typeof verifyBaseSepoliaTransaction>;
type ManifestSigner = (binding: OperatorOrderBinding, operatorId: string) => Promise<string>;
type ReceiptSigner = (canonicalReceipt: string) => Promise<string>;
type ReceiptVerifier = (canonicalReceipt: string, signature: string) => Promise<void>;
type AuthorizationKind = 'ADDRESS_ALLOCATION' | 'PAYOUT';
type AuthorizationSigner = (domain: 'allocation-authorization-v1' | 'payout-authorization-v1', canonicalPayload: string) => Promise<string>;
type AuthorizationVerifier = (domain: 'allocation-authorization-v1' | 'payout-authorization-v1', canonicalPayload: string, signature: string) => Promise<void>;

type OrderRow = {
  order_id: string; owner_session_hash: Buffer; immutable_manifest: { binding: OperatorOrderBinding; requestId: string };
  public_view: Record<string, unknown>; encrypted_private_state: Buffer; encryption_key_version: number;
  status: PaymentOrder['status']; state_version: string; created_at: Date; expires_at: Date; accepted_by: string;
};

export type PendingRequest = {
  requestId: string; createdAt: string; expiresAt: string; destinationRecipient: string;
  terms: typeof PUBLIC_ROUTE_TERMS;
};

export type AddressAllocationPhase = 'JOURNALED' | 'DERIVATION_STARTED' | 'RPC_UNCERTAIN' | 'DERIVED' | 'RESERVED' | 'RECOVERY_REQUIRED' | 'CANCELLED';
export type AddressAllocationOperation = {
  allocationId: string; authorizationId: string; orderId: string; operatorId: string;
  diversifierIndex: string; phase: AddressAllocationPhase; rpcAttemptCount: number; address?: string;
};

function ownerHash(ownerId: string): Buffer { return createHash('sha256').update(ownerId).digest(); }
function fingerprint(value: string): Buffer { return createHash('sha256').update(value.toLowerCase()).digest(); }
function orderContext(id: string): string { return `order:${id}:private-state`; }
function evidenceContext(id: string, chain: string): string { return `order:${id}:evidence:${chain}`; }
function receiptContext(id: string): string { return `receipt:${id}:private`; }

function publicOrder(order: PaymentOrder): Record<string, unknown> {
  return {
    id: order.id, createdAt: order.createdAt, status: order.status, expiresAt: order.expiresAt,
    source: { network: order.sourceNetwork, asset: order.sourceAsset, pool: order.sourcePool, amountZatoshis: order.sourceAmountZat, confirmations: order.sourceMinimumConfirmations },
    destination: { network: order.destinationNetwork, chainId: order.destinationChainId, asset: order.destinationAsset.symbol, contract: order.destinationAsset.contract, amountAtomic: order.destinationAmountAtomic, confirmations: order.destinationMinimumConfirmations },
    provider: order.provider, fixedRate: order.fixedRate, payoutAuthorization: { state: order.payoutAuthorization.state },
    sourceReceipt: order.sourceReceipt && { verification: 'independent', confirmations: order.sourceReceipt.confirmations },
    destinationReceipt: order.destinationReceipt && { verification: 'independent' },
    finalReceiptId: order.finalReceiptId, resolutionReason: order.resolutionReason,
  };
}

function sourceLink(evidence: Awaited<ReturnType<SourceVerifier>>, verifiedAt = new Date().toISOString()): SourceReceiptLink {
  return {
    transactionId: evidence.transactionId, verifiedAt, verification: 'independent', verifier: 'zcash-rpc-adapter',
    amountZatoshis: evidence.amountZatoshis, outputIndex: evidence.outputIndex, diversifierIndex: evidence.diversifierIndex,
    blockHeight: evidence.blockHeight, blockHash: evidence.blockHash, blockTime: evidence.blockTime, confirmations: evidence.confirmations,
  };
}

function canonicalReceipt(receipt: FinalReceipt): string {
  return JSON.stringify(Object.fromEntries(Object.entries(receipt).sort(([left], [right]) => left.localeCompare(right))));
}

function canonicalAuthorization(payload: Record<string, unknown>): string { return JSON.stringify(Object.fromEntries(Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)))); }
function authorizationDomain(kind: AuthorizationKind) { return kind === 'ADDRESS_ALLOCATION' ? 'allocation-authorization-v1' as const : 'payout-authorization-v1' as const; }

export class PostgresSettlementStore {
  private readonly pool: Pool;
  private readonly encryption: DataEncryption;
  constructor(pool: Pool, encryption: DataEncryption) { this.pool = pool; this.encryption = encryption; }

  async health(): Promise<void> {
    const result = await this.pool.query("SELECT version FROM schema_migrations WHERE version = ANY($1::text[])", [['002_settlement_integration', '003_private_verification_relay', '004_crash_safe_address_allocation']]);
    if (result.rowCount !== 3) throw new Error('Settlement, private relay, or crash-safe allocation migration is missing');
  }

  async pendingRequests(now = Date.now()): Promise<PendingRequest[]> {
    await this.pool.query(`UPDATE public_order_requests SET status='EXPIRED', updated_at=$1 WHERE status='AWAITING_OPERATOR' AND expires_at <= $1`, [new Date(now)]);
    const result = await this.pool.query<{ request_id: string; created_at: Date; expires_at: Date; destination_recipient: string; immutable_terms: typeof PUBLIC_ROUTE_TERMS }>(
      `SELECT request_id, created_at, expires_at, destination_recipient, immutable_terms FROM public_order_requests WHERE status='AWAITING_OPERATOR' AND expires_at > $1 ORDER BY created_at`, [new Date(now)]);
    return result.rows.map(row => ({ requestId: row.request_id, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), destinationRecipient: row.destination_recipient, terms: row.immutable_terms }));
  }

  async acceptRequest(requestId: string, operatorId: string, expectedRecipient: string, signer: ManifestSigner, now = Date.now()): Promise<{ orderId: string; signature: string }> {
    if (!operatorId.trim()) throw new Error('Operator identity is required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<{ request_id: string; owner_session_hash: Buffer; status: string; expires_at: Date; destination_recipient: string; immutable_terms: typeof PUBLIC_ROUTE_TERMS }>(
        `SELECT request_id, owner_session_hash, status, expires_at, destination_recipient, immutable_terms FROM public_order_requests WHERE request_id=$1 FOR UPDATE`, [requestId]);
      const request = selected.rows[0];
      if (!request) throw new Error('Public request not found');
      if (request.status !== 'AWAITING_OPERATOR') throw new Error('Public request has already been accepted or closed');
      if (request.destination_recipient.toLowerCase() !== expectedRecipient.toLowerCase()) throw new Error('Operator-confirmed destination recipient does not match the public request');
      if (request.expires_at.getTime() <= now) {
        await client.query(`UPDATE public_order_requests SET status='EXPIRED', updated_at=$2 WHERE request_id=$1`, [requestId, new Date(now)]);
        throw new Error('Public request has expired');
      }
      if (!isDeepStrictEqual(request.immutable_terms, PUBLIC_ROUTE_TERMS)) throw new Error('Public request terms are no longer eligible');
      const binding = createOperatorOrderBinding({ orderId: request.request_id, destinationRecipient: request.destination_recipient, expiresAt: request.expires_at.toISOString(), now });
      validateOperatorOrderBinding(binding, now);
      const signature = await signer(binding, operatorId);
      if (!/^[0-9a-f]{64}$/i.test(signature)) throw new Error('Signed operator manifest is invalid');
      const acceptedState = { phase: 'ACCEPTED', requestId, binding, operatorId };
      await client.query(`INSERT INTO orders
        (order_id, request_id, owner_session_hash, immutable_manifest, manifest_signature, accepted_by, public_view, encrypted_private_state, encryption_key_version, status, created_at, expires_at, updated_at)
        VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,'CREATED',$9,$10,$9)`, [
        requestId, request.owner_session_hash, { version: 1, requestId, binding }, Buffer.from(signature, 'hex'), operatorId,
        { id: requestId, createdAt: new Date(now).toISOString(), status: 'CREATED', expiresAt: binding.expiresAt },
        this.encryption.encrypt(acceptedState, orderContext(requestId)), this.encryption.activeVersion, new Date(now), request.expires_at,
      ]);
      await client.query(`UPDATE public_order_requests SET status='ACCEPTED', linked_order_id=$1, accepted_at=$2, accepted_by=$3, manifest_signature=$4, updated_at=$2 WHERE request_id=$1`, [requestId, new Date(now), operatorId, Buffer.from(signature, 'hex')]);
      await this.audit(client, requestId, 'OPERATOR', operatorId, 'PUBLIC_REQUEST_ACCEPTED', { requestId, manifestVersion: 1 });
      await client.query('COMMIT');
      return { orderId: requestId, signature };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async issueAuthorization(orderId: string, kind: AuthorizationKind, operatorId: string, signer: AuthorizationSigner, now = Date.now(), ttlSeconds = 900): Promise<string> {
    if (!operatorId.trim() || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) throw new Error('Operator identity and a safe authorization lifetime are required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const order = await this.lockOrder(client, orderId);
      if (kind === 'ADDRESS_ALLOCATION' && order.status !== 'CREATED') throw new Error('Order is not awaiting allocation authorization');
      if (kind === 'PAYOUT' && this.privateOrder(order).status !== 'PAYOUT_AWAITING_APPROVAL') throw new Error('Order is not awaiting payout authorization');
      await client.query(`UPDATE authorization_records SET state='EXPIRED',updated_at=$2 WHERE order_id=$1 AND kind=$3 AND state='ISSUED' AND expires_at <= $2`, [orderId, new Date(now), kind]);
      const authorizationId = randomUUID(); const expiresAt = new Date(now + ttlSeconds * 1000);
      const payload = { authorizationId, orderId, kind, operatorId, manifestFingerprint: createHash('sha256').update(JSON.stringify(order.immutable_manifest)).digest('hex'), issuedAt: new Date(now).toISOString(), expiresAt: expiresAt.toISOString() };
      const signature = await signer(authorizationDomain(kind), canonicalAuthorization(payload));
      if (!/^[0-9a-f]{64}$/i.test(signature)) throw new Error('Operator authorization signature is invalid');
      await client.query(`INSERT INTO authorization_records(authorization_id,order_id,kind,operator_id,manifest_fingerprint,state,issued_at,expires_at,target,signed_payload,signature,updated_at) VALUES($1,$2,$3,$4,$5,'ISSUED',$6,$7,$8,$9,$10,$6)`, [authorizationId, orderId, kind, operatorId, Buffer.from(payload.manifestFingerprint, 'hex'), new Date(now), expiresAt, `order:${orderId}`, payload, Buffer.from(signature, 'hex')]);
      await this.audit(client, orderId, 'OPERATOR', operatorId, `${kind}_AUTHORIZED`, { authorizationId, expiresAt: expiresAt.toISOString() }); await client.query('COMMIT'); return authorizationId;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async beginAddressAllocation(orderId: string, operatorId: string, authorizationId: string, diversifierIndex: string, verifier: AuthorizationVerifier, now = Date.now()): Promise<AddressAllocationOperation> {
    if (!/^\d+$/.test(diversifierIndex)) throw new Error('Diversifier index must be an unsigned decimal integer');
    diversifierIndex = BigInt(diversifierIndex).toString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.lockOrder(client, orderId);
      const existing = await client.query<{
        allocation_id: string; authorization_id: string; journal_phase: AddressAllocationPhase; encrypted_derivation: Buffer;
        encrypted_receiver: Buffer | null; rpc_attempt_count: number;
      }>(`SELECT allocation_id,authorization_id,journal_phase,encrypted_derivation,encrypted_receiver,rpc_attempt_count
          FROM address_allocation_journal WHERE order_id=$1 FOR UPDATE`, [orderId]);
      if (existing.rows[0]) {
        await this.verifyAuthorization(client, row, 'ADDRESS_ALLOCATION', authorizationId, operatorId, verifier, ['IN_PROGRESS','CONSUMED'], now);
        const operation = this.allocationOperation(existing.rows[0], row, operatorId);
        if (operation.authorizationId !== authorizationId || operation.diversifierIndex !== diversifierIndex) throw new Error('Order already has a different durable allocation operation');
        await client.query('COMMIT');
        return operation;
      }
      if (row.status !== 'CREATED' || row.expires_at.getTime() <= now) throw new Error('Order is not an unexpired accepted order awaiting allocation');
      await this.validateAcceptedOrder(client, row, operatorId, now);
      await this.startAllocationAuthorization(client, row, authorizationId, operatorId, verifier, now);
      const manifest = row.immutable_manifest.binding;
      validateOperatorOrderBinding(manifest, now);
      const allocationId = randomUUID();
      await client.query(`INSERT INTO address_allocation_journal
        (allocation_id,order_id,authorization_id,diversifier_fingerprint,encrypted_derivation,encryption_key_version,journal_phase,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,'JOURNALED',$7,$7)`, [
        allocationId, orderId, authorizationId, fingerprint(diversifierIndex),
        this.encryption.encrypt({ diversifierIndex }, `allocation:${allocationId}:derivation`), this.encryption.activeVersion, new Date(now),
      ]);
      await this.audit(client, orderId, 'OPERATOR', operatorId, 'ALLOCATION_DIVERSIFIER_JOURNALED', { allocationId, authorizationId, rpcAttempted: false });
      await client.query('COMMIT');
      return { allocationId, authorizationId, orderId, operatorId, diversifierIndex, phase: 'JOURNALED', rpcAttemptCount: 0 };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async addressAllocationOperation(orderId: string, authorizationId: string, operatorId: string): Promise<AddressAllocationOperation> {
    const result = await this.pool.query<{
      allocation_id: string; authorization_id: string; journal_phase: AddressAllocationPhase; encrypted_derivation: Buffer;
      encrypted_receiver: Buffer | null; rpc_attempt_count: number; accepted_by: string;
    }>(`SELECT j.allocation_id,j.authorization_id,j.journal_phase,j.encrypted_derivation,j.encrypted_receiver,j.rpc_attempt_count,o.accepted_by
        FROM address_allocation_journal j JOIN orders o ON o.order_id=j.order_id
        WHERE j.order_id=$1 AND j.authorization_id=$2`, [orderId, authorizationId]);
    const record = result.rows[0];
    if (!record) throw new Error('Allocation recovery record not found');
    return this.allocationOperation(record, { order_id: orderId, accepted_by: record.accepted_by } as OrderRow, operatorId);
  }

  async authenticateAddressAllocation(orderId: string, authorizationId: string, operatorId: string, verifier: AuthorizationVerifier, now = Date.now()): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const row = await this.lockOrder(client, orderId);
      const journal = await client.query('SELECT 1 FROM address_allocation_journal WHERE order_id=$1 AND authorization_id=$2 FOR UPDATE', [orderId, authorizationId]);
      if (journal.rowCount !== 1) throw new Error('Allocation recovery record not found');
      await this.verifyAuthorization(client, row, 'ADDRESS_ALLOCATION', authorizationId, operatorId, verifier, ['IN_PROGRESS','CONSUMED'], now);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async markAddressDerivationStarted(orderId: string, authorizationId: string, operatorId: string, now = Date.now()): Promise<AddressAllocationOperation> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const row = await this.lockOrder(client, orderId);
      const selected = await client.query<any>(`SELECT * FROM address_allocation_journal WHERE order_id=$1 AND authorization_id=$2 FOR UPDATE`, [orderId, authorizationId]);
      const record = selected.rows[0]; if (!record) throw new Error('Allocation recovery record not found');
      const operation = this.allocationOperation(record, row, operatorId);
      if (operation.phase === 'RESERVED' || operation.phase === 'DERIVED') { await client.query('COMMIT'); return operation; }
      if (!['JOURNALED','DERIVATION_STARTED','RPC_UNCERTAIN','RECOVERY_REQUIRED'].includes(operation.phase)) throw new Error('Allocation operation cannot call the wallet RPC from its current state');
      const updated = await client.query<{ rpc_attempt_count: number }>(`UPDATE address_allocation_journal SET journal_phase='DERIVATION_STARTED',rpc_attempt_count=rpc_attempt_count+1,rpc_attempted_at=$3,last_error_code=NULL,updated_at=$3 WHERE order_id=$1 AND authorization_id=$2 RETURNING rpc_attempt_count`, [orderId, authorizationId, new Date(now)]);
      await this.audit(client, orderId, 'OPERATOR', operatorId, 'ALLOCATION_DERIVATION_ATTEMPT_STARTED', { allocationId: operation.allocationId, authorizationId, attempt: updated.rows[0].rpc_attempt_count, sameJournaledDiversifier: true });
      await client.query('COMMIT'); return { ...operation, phase: 'DERIVATION_STARTED', rpcAttemptCount: updated.rows[0].rpc_attempt_count };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async markAddressDerivationUncertain(orderId: string, authorizationId: string, operatorId: string, errorCode: string, now = Date.now()): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const row = await this.lockOrder(client, orderId);
      if (row.accepted_by !== operatorId) throw new Error('Operator identity does not match the accepted order');
      const changed = await client.query(`UPDATE address_allocation_journal SET journal_phase='RPC_UNCERTAIN',last_error_code=$3,updated_at=$4 WHERE order_id=$1 AND authorization_id=$2 AND journal_phase='DERIVATION_STARTED'`, [orderId, authorizationId, errorCode, new Date(now)]);
      if (changed.rowCount !== 1) throw new Error('Allocation operation is not an in-flight derivation');
      await this.audit(client, orderId, 'OPERATOR', operatorId, 'ALLOCATION_DERIVATION_UNCERTAIN', { authorizationId, errorCode, replacementForbidden: true });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async markAddressRecoveryRequired(orderId: string, authorizationId: string, operatorId: string, errorCode: string, now = Date.now()): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const row = await this.lockOrder(client, orderId);
      if (row.accepted_by !== operatorId) throw new Error('Operator identity does not match the accepted order');
      const changed = await client.query(`UPDATE address_allocation_journal SET journal_phase='RECOVERY_REQUIRED',last_error_code=$3,updated_at=$4 WHERE order_id=$1 AND authorization_id=$2 AND journal_phase IN ('DERIVATION_STARTED','DERIVED')`, [orderId, authorizationId, errorCode, new Date(now)]);
      if (changed.rowCount !== 1) throw new Error('Allocation operation cannot enter recovery from its current state');
      await this.audit(client, orderId, 'OPERATOR', operatorId, 'ALLOCATION_RECOVERY_REQUIRED', { authorizationId, errorCode, replacementForbidden: true });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async recordDerivedAddress(orderId: string, authorizationId: string, operatorId: string, address: string, diversifierIndex: string, now = Date.now()): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const row = await this.lockOrder(client, orderId);
      const selected = await client.query<any>(`SELECT * FROM address_allocation_journal WHERE order_id=$1 AND authorization_id=$2 FOR UPDATE`, [orderId, authorizationId]);
      const record = selected.rows[0]; if (!record) throw new Error('Allocation recovery record not found');
      const operation = this.allocationOperation(record, row, operatorId);
      if (operation.diversifierIndex !== BigInt(diversifierIndex).toString()) throw new Error('Derived diversifier does not match the journaled index');
      if (operation.phase === 'DERIVED' || operation.phase === 'RESERVED') {
        if (operation.address !== address) throw new Error('Recorded derivation does not match the wallet response');
        await client.query('COMMIT'); return;
      }
      if (operation.phase !== 'DERIVATION_STARTED') throw new Error('Allocation operation is not an in-flight derivation');
      await client.query(`UPDATE address_allocation_journal SET journal_phase='DERIVED',address_fingerprint=$3,encrypted_receiver=$4,derived_at=$5,last_error_code=NULL,updated_at=$5 WHERE order_id=$1 AND authorization_id=$2`, [
        orderId, authorizationId, fingerprint(address), this.encryption.encrypt({ receiver: address, diversifierIndex: operation.diversifierIndex }, `allocation:${operation.allocationId}:receiver`), new Date(now),
      ]);
      await this.audit(client, orderId, 'OPERATOR', operatorId, 'ALLOCATION_DERIVED_RECORDED', { allocationId: operation.allocationId, authorizationId, receiverDisplayed: false });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async reserveDerivedAddress(orderId: string, operatorId: string, authorizationId: string, candidate: ValidatedReceivingAddress, now = Date.now()): Promise<string> {
    if (candidate.state !== 'AVAILABLE') throw new Error('Allocation must be independently validated as available');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const row = await this.lockOrder(client, orderId);
      const selected = await client.query<any>(`SELECT * FROM address_allocation_journal WHERE order_id=$1 AND authorization_id=$2 FOR UPDATE`, [orderId, authorizationId]);
      const record = selected.rows[0]; if (!record) throw new Error('Allocation recovery record not found');
      const operation = this.allocationOperation(record, row, operatorId);
      if (operation.phase === 'RESERVED') { await client.query('COMMIT'); return operation.allocationId; }
      if (operation.phase !== 'DERIVED' || !operation.address || operation.address !== candidate.address || operation.diversifierIndex !== candidate.diversifierIndex || operation.allocationId !== candidate.allocationId) throw new Error('Validated receiver does not match the durable derived allocation');
      if (row.status !== 'CREATED') throw new Error('Order is not awaiting allocation');
      const manifest = row.immutable_manifest.binding; validateOperatorOrderBinding(manifest, row.created_at.getTime());
      const order = createOrder({ allocationId: operation.allocationId, destinationRecipient: manifest.destinationRecipient, sourceAmountZat: manifest.sourceAmountZat, expiresAt: manifest.expiresAt, providerId: manifest.providerId }, {
        allocationId: operation.allocationId, sourceReceiver: candidate.address, sourceDiversifierIndex: candidate.diversifierIndex, sourceNotBeforeHeight: candidate.sourceNotBeforeHeight,
      }, row.created_at.getTime(), orderId);
      await this.updateOrder(client, row, order, now);
      await client.query(`UPDATE address_allocation_journal SET journal_phase='RESERVED',source_not_before_height=$3,reserved_at=$4,updated_at=$4 WHERE order_id=$1 AND authorization_id=$2`, [orderId, authorizationId, candidate.sourceNotBeforeHeight, new Date(now)]);
      const consumed = await client.query(`UPDATE authorization_records SET state='CONSUMED',consumed_at=$2,updated_at=$2 WHERE authorization_id=$1 AND state='IN_PROGRESS'`, [authorizationId, new Date(now)]);
      if (consumed.rowCount !== 1) throw new Error('Allocation authorization is not in progress');
      await this.audit(client, orderId, 'OPERATOR', operatorId, 'ALLOCATION_RESERVED', { allocationId: operation.allocationId, authorizationId, validation: 'independent-wallet-rpc' });
      await client.query('COMMIT'); return operation.allocationId;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async cancelAddressAllocation(orderId: string, authorizationId: string, operatorId: string, verifier: AuthorizationVerifier, reason: string, now = Date.now()): Promise<void> {
    if (!reason.trim()) throw new Error('Cancellation reason is required');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const row = await this.lockOrder(client, orderId);
      const selected = await client.query<any>(`SELECT * FROM address_allocation_journal WHERE order_id=$1 AND authorization_id=$2 FOR UPDATE`, [orderId, authorizationId]);
      const record = selected.rows[0]; if (!record) throw new Error('Allocation recovery record not found');
      const operation = this.allocationOperation(record, row, operatorId);
      if (operation.phase === 'CANCELLED') { await client.query('COMMIT'); return; }
      if (operation.phase !== 'JOURNALED' || operation.rpcAttemptCount !== 0 || record.rpc_attempted_at) throw new Error('An allocation can be cancelled only when no wallet RPC attempt has begun; reconcile it instead');
      await this.verifyAuthorization(client, row, 'ADDRESS_ALLOCATION', authorizationId, operatorId, verifier, ['IN_PROGRESS'], now);
      await client.query(`UPDATE address_allocation_journal SET journal_phase='CANCELLED',cancelled_at=$3,cancellation_reason=$4,updated_at=$3 WHERE order_id=$1 AND authorization_id=$2`, [orderId, authorizationId, new Date(now), reason.trim()]);
      await client.query(`UPDATE authorization_records SET state='CANCELLED',updated_at=$2 WHERE authorization_id=$1 AND state='IN_PROGRESS'`, [authorizationId, new Date(now)]);
      await this.audit(client, orderId, 'OPERATOR', operatorId, 'ALLOCATION_CANCELLED_BEFORE_RPC', { allocationId: operation.allocationId, authorizationId, reason: reason.trim() });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async publishPaymentInstructions(orderId: string, operatorId: string, now = Date.now()): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.lockOrder(client, orderId); const order = this.privateOrder(row);
      const allocation = await client.query<{ journal_phase: string }>(`SELECT journal_phase FROM address_allocation_journal WHERE order_id=$1 FOR UPDATE`, [orderId]);
      if (allocation.rows[0]?.journal_phase !== 'RESERVED') throw new Error('A durably reserved allocation is required');
      const next = activateOrder(order, now);
      if (next.status !== 'AWAITING_PAYMENT') throw new Error('Order expired before payment instructions could be published');
      const receiver = this.encryption.encrypt({ receiver: next.sourceReceiver }, `request:${orderId}:receiver`);
      await this.updateOrder(client, row, next, now);
      await client.query(`UPDATE public_order_requests SET status='PAYMENT_READY', encrypted_payment_receiver=$2, payment_receiver_key_version=$3, updated_at=$4 WHERE request_id=$1 AND status='ACCEPTED'`, [orderId, receiver, this.encryption.activeVersion, new Date(now)]);
      await this.audit(client, orderId, 'OPERATOR', operatorId, 'PAYMENT_INSTRUCTIONS_PUBLISHED', { allocationValidated: true });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async observeSource(orderId: string, transactionId: string, verifier: SourceVerifier = verifyZcashTransaction, now = Date.now()): Promise<void> {
    const snapshot = await this.readOrder(orderId); const order = this.privateOrder(snapshot);
    if (order.status !== 'AWAITING_PAYMENT') throw new Error('Order is not awaiting source payment');
    const evidence = await verifier({ orderId, transactionId, receiver: order.sourceReceiver, amountZatoshis: order.sourceAmountZat, expectedDiversifierIndex: order.sourceDiversifierIndex, minimumBlockHeight: order.sourceNotBeforeHeight, minimumBlockTime: Math.floor(Date.parse(order.createdAt) / 1000), requiredPool: 'ironwood', minimumConfirmations: 1 });
    const verified = verifyZcashShieldedReceipt(order, evidence); if (verified.outcome !== 'verified') throw new Error(`Source ${verified.outcome}: ${verified.reason}`);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const locked = await this.lockOrder(client, orderId);
      if (locked.state_version !== snapshot.state_version) throw new Error('Order changed while source evidence was being verified');
      const current = this.privateOrder(locked); const next = attachSourceEvidence(current, sourceLink(evidence), now);
      const reference = fingerprint(`${evidence.transactionId}:${evidence.outputIndex}`);
      await client.query(`INSERT INTO replay_references(chain,reference_fingerprint,order_id,reference_kind,reserved_at) VALUES('zcash-testnet',$1,$2,'SOURCE_OUTPUT',$3)`, [reference, orderId, new Date(now)]);
      await client.query(`INSERT INTO settlement_evidence(evidence_id,order_id,chain,reference_fingerprint,encrypted_evidence,encryption_key_version,independently_verified_at) VALUES($1,$2,'zcash-testnet',$3,$4,$5,$6)`, [randomUUID(), orderId, reference, this.encryption.encrypt(evidence, evidenceContext(orderId, 'zcash-testnet')), this.encryption.activeVersion, new Date()]);
      await this.updateOrder(client, locked, next, now); await this.syncRequestStatus(client, orderId, next.status, now);
      await this.audit(client, orderId, 'VERIFIER', undefined, 'SOURCE_EVIDENCE_VERIFIED', { confirmations: evidence.confirmations, late: next.status === 'REFUND_PENDING' });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async confirmSource(orderId: string, verifier: SourceVerifier = verifyZcashTransaction, now = Date.now()): Promise<void> {
    const snapshot = await this.readOrder(orderId); const order = this.privateOrder(snapshot);
    if (!order.sourceReceipt) throw new Error('No detected source payment exists');
    const evidence = await verifier({ orderId, transactionId: order.sourceReceipt.transactionId, receiver: order.sourceReceiver, amountZatoshis: order.sourceAmountZat, expectedDiversifierIndex: order.sourceDiversifierIndex, minimumBlockHeight: order.sourceNotBeforeHeight, minimumBlockTime: Math.floor(Date.parse(order.createdAt) / 1000), requiredPool: 'ironwood', minimumConfirmations: order.sourceMinimumConfirmations });
    const verified = verifyZcashShieldedReceipt(order, evidence); if (verified.outcome !== 'verified') throw new Error(`Source ${verified.outcome}: ${verified.reason}`);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const locked = await this.lockOrder(client, orderId);
      if (locked.state_version !== snapshot.state_version) throw new Error('Order changed while source confirmations were being verified');
      const next = confirmSourceEvidence(this.privateOrder(locked), sourceLink(evidence));
      await client.query(`UPDATE settlement_evidence SET encrypted_evidence=$2,encryption_key_version=$3,independently_verified_at=$4 WHERE order_id=$1 AND chain='zcash-testnet'`, [orderId, this.encryption.encrypt(evidence, evidenceContext(orderId, 'zcash-testnet')), this.encryption.activeVersion, new Date(now)]);
      await this.updateOrder(client, locked, next, now); await this.syncRequestStatus(client, orderId, next.status, now);
      await this.audit(client, orderId, 'VERIFIER', undefined, 'SOURCE_CONFIRMATIONS_VERIFIED', { confirmations: evidence.confirmations });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async applyRelaySourceEvidence(jobId: string, envelope: SignedRelayEvidence, now = Date.now()): Promise<void> {
    if (envelope.payload.outcome !== 'VERIFIED' || !envelope.payload.evidence) throw new Error('Only verified relay evidence can be applied');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const jobResult = await client.query<{ order_id: string; phase: 'SOURCE_DETECTION' | 'SOURCE_CONFIRMATION'; state: string; manifest_fingerprint: Buffer; request_fingerprint: Buffer }>('SELECT order_id,phase,state,manifest_fingerprint,request_fingerprint FROM private_verification_jobs WHERE job_id=$1 FOR UPDATE', [jobId]);
      const job = jobResult.rows[0]; if (!job || job.state !== 'RECEIVED') throw new Error('Relay evidence is not ready to apply');
      if (envelope.payload.jobId !== jobId || envelope.payload.orderId !== job.order_id || envelope.payload.phase !== job.phase) throw new Error('Relay job identity mismatch');
      const row = await this.lockOrder(client, job.order_id); const order = this.privateOrder(row); const evidence = envelope.payload.evidence;
      if (!job.manifest_fingerprint.equals(Buffer.from(relayFingerprint(row.immutable_manifest), 'hex')) || envelope.payload.manifestFingerprint !== job.manifest_fingerprint.toString('hex')) throw new Error('Relay manifest binding mismatch');
      const request: ZcashVerificationRequest = {
        orderId: order.id, transactionId: evidence.transactionId, receiver: order.sourceReceiver, amountZatoshis: order.sourceAmountZat,
        expectedDiversifierIndex: order.sourceDiversifierIndex, minimumBlockHeight: order.sourceNotBeforeHeight,
        minimumBlockTime: Math.floor(Date.parse(order.createdAt) / 1000), requiredPool: 'ironwood',
        minimumConfirmations: job.phase === 'SOURCE_DETECTION' ? 1 : order.sourceMinimumConfirmations,
      };
      if (!job.request_fingerprint.equals(Buffer.from(relayFingerprint(request), 'hex')) || envelope.payload.requestFingerprint !== job.request_fingerprint.toString('hex')) throw new Error('Relay request binding mismatch');
      const checked = verifyZcashShieldedReceipt(order, evidence); if (checked.outcome !== 'verified') throw new Error(`Source ${checked.outcome}: ${checked.reason}`);
      let next: PaymentOrder;
      if (job.phase === 'SOURCE_DETECTION') {
        next = attachSourceEvidence(order, sourceLink(evidence), now);
        const reference = fingerprint(`${evidence.transactionId}:${evidence.outputIndex}`);
        await client.query(`INSERT INTO replay_references(chain,reference_fingerprint,order_id,reference_kind,reserved_at) VALUES('zcash-testnet',$1,$2,'SOURCE_OUTPUT',$3)`, [reference, order.id, new Date(now)]);
        await client.query(`INSERT INTO settlement_evidence(evidence_id,order_id,chain,reference_fingerprint,encrypted_evidence,encryption_key_version,independently_verified_at) VALUES($1,$2,'zcash-testnet',$3,$4,$5,$6)`, [randomUUID(), order.id, reference, this.encryption.encrypt(evidence, evidenceContext(order.id, 'zcash-testnet')), this.encryption.activeVersion, new Date(now)]);
      } else {
        next = confirmSourceEvidence(order, sourceLink(evidence));
        const updated = await client.query(`UPDATE settlement_evidence SET encrypted_evidence=$2,encryption_key_version=$3,independently_verified_at=$4 WHERE order_id=$1 AND chain='zcash-testnet'`, [order.id, this.encryption.encrypt(evidence, evidenceContext(order.id, 'zcash-testnet')), this.encryption.activeVersion, new Date(now)]);
        if (updated.rowCount !== 1) throw new Error('Detected source evidence is missing');
      }
      await this.updateOrder(client, row, next, now); await this.syncRequestStatus(client, order.id, next.status, now);
      const applied = await client.query(`UPDATE private_verification_jobs SET state='APPLIED',applied_at=$2,updated_at=$2 WHERE job_id=$1 AND state='RECEIVED'`, [jobId, new Date(now)]);
      if (applied.rowCount !== 1) throw new Error('Relay evidence was already applied');
      await this.audit(client, order.id, 'VERIFIER', envelope.payload.verifierId, job.phase === 'SOURCE_DETECTION' ? 'RELAY_SOURCE_EVIDENCE_APPLIED' : 'RELAY_SOURCE_CONFIRMATIONS_APPLIED', { jobId, confirmations: evidence.confirmations });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async applyRelayUnresolved(jobId: string, envelope: SignedRelayEvidence, now = Date.now()): Promise<void> {
    if (envelope.payload.outcome !== 'UNRESOLVED' || !envelope.payload.reasonCode || envelope.payload.evidence) throw new Error('Only unresolved relay evidence can be applied here');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const jobResult = await client.query<{ order_id: string; state: string; verifier_id: string }>('SELECT order_id,state,verifier_id FROM private_verification_jobs WHERE job_id=$1 FOR UPDATE', [jobId]);
      const job = jobResult.rows[0]; if (!job || job.state !== 'UNRESOLVED') throw new Error('Relay job is not unresolved');
      if (envelope.payload.jobId !== jobId || envelope.payload.orderId !== job.order_id || envelope.payload.verifierId !== job.verifier_id) throw new Error('Relay unresolved identity mismatch');
      const row = await this.lockOrder(client, job.order_id); const next = markUnresolved(this.privateOrder(row), `private-verifier:${envelope.payload.reasonCode.toLowerCase()}`);
      await this.updateOrder(client, row, next, now); await this.syncRequestStatus(client, row.order_id, next.status, now);
      const applied = await client.query(`UPDATE private_verification_jobs SET state='APPLIED',applied_at=$2,updated_at=$2 WHERE job_id=$1 AND state='UNRESOLVED'`, [jobId, new Date(now)]);
      if (applied.rowCount !== 1) throw new Error('Relay unresolved result was already applied');
      await this.audit(client, row.order_id, 'VERIFIER', job.verifier_id, 'RELAY_UNRESOLVED_APPLIED', { jobId, reasonCode: envelope.payload.reasonCode });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async queuePayout(orderId: string, operatorId: string, now = Date.now()): Promise<void> { await this.transition(orderId, 'OPERATOR', operatorId, 'PAYOUT_REVIEW_QUEUED', now, queuePayoutApproval); }
  async approvePayout(orderId: string, operatorId: string, authorizationId: string, verifier: AuthorizationVerifier, now = Date.now()): Promise<void> {
    const client = await this.pool.connect(); try { await client.query('BEGIN'); const row = await this.lockOrder(client, orderId); await this.consumeAuthorization(client, row, 'PAYOUT', authorizationId, operatorId, verifier, now); const next = authorizePayout(this.privateOrder(row), operatorId, authorizationId, now); await this.updateOrder(client, row, next, now); await this.syncRequestStatus(client, orderId, next.status, now); await this.audit(client, orderId, 'OPERATOR', operatorId, 'PAYOUT_APPROVED', { authorizationId }); await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async recordPayout(orderId: string, operatorId: string, transactionId: string, now = Date.now()): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const row = await this.lockOrder(client, orderId); const next = recordPayoutSubmission(this.privateOrder(row), transactionId, now);
      await client.query(`INSERT INTO replay_references(chain,reference_fingerprint,order_id,reference_kind,reserved_at) VALUES('base-sepolia',$1,$2,'PAYOUT_TRANSACTION',$3)`, [fingerprint(transactionId), orderId, new Date(now)]);
      await this.updateOrder(client, row, next, now); await this.syncRequestStatus(client, orderId, next.status, now); await this.audit(client, orderId, 'OPERATOR', operatorId, 'PAYOUT_REFERENCE_RECORDED', {}); await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async verifyPayout(orderId: string, signer: ReceiptSigner, verifier: DestinationVerifier = verifyBaseSepoliaTransaction, now = Date.now()): Promise<string> {
    const snapshot = await this.readOrder(orderId); const order = this.privateOrder(snapshot);
    if (!order.payoutTransactionId || order.status !== 'PAYOUT_SUBMITTED') throw new Error('No approved payout submission exists');
    const evidence = await verifier({ orderId, transactionId: order.payoutTransactionId, recipient: order.destinationRecipient, amountAtomic: order.destinationAmountAtomic, minimumConfirmations: order.destinationMinimumConfirmations });
    const checked = verifyBaseSepoliaErc20Receipt(order, evidence); if (checked.outcome !== 'verified') throw new Error(`Destination ${checked.outcome}: ${checked.reason}`);
    const destination: DestinationReceiptLink = { ...checked, amountAtomic: evidence.amountAtomic };
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); const locked = await this.lockOrder(client, orderId);
      if (locked.state_version !== snapshot.state_version) throw new Error('Order changed while destination evidence was being verified');
      const current = this.privateOrder(locked); const withDestination = attachDestinationEvidence(current, destination);
      const receipt = createFinalReceipt(withDestination, withDestination.sourceReceipt!, destination, randomUUID());
      const signature = await signer(canonicalReceipt(receipt));
      if (!/^[0-9a-f]{64}$/i.test(signature)) throw new Error('Receipt authenticator returned an invalid signature');
      const completed = completeOrder(withDestination, receipt.receiptId);
      await client.query(`INSERT INTO settlement_evidence(evidence_id,order_id,chain,reference_fingerprint,encrypted_evidence,encryption_key_version,independently_verified_at) VALUES($1,$2,'base-sepolia',$3,$4,$5,$6)`, [randomUUID(), orderId, fingerprint(order.payoutTransactionId), this.encryption.encrypt(evidence, evidenceContext(orderId, 'base-sepolia')), this.encryption.activeVersion, new Date(now)]);
      await client.query(`INSERT INTO receipts(receipt_id,order_id,public_receipt,encrypted_private_receipt,encryption_key_version,authenticity_hmac,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [receipt.receiptId, orderId, toShareableReceipt(receipt), this.encryption.encrypt(receipt, receiptContext(receipt.receiptId)), this.encryption.activeVersion, Buffer.from(signature, 'hex'), new Date(now)]);
      await this.updateOrder(client, locked, completed, now); await this.syncRequestStatus(client, orderId, completed.status, now); await this.audit(client, orderId, 'VERIFIER', undefined, 'FINAL_RECEIPT_CREATED', { receiptId: receipt.receiptId, independentlyVerified: true }); await client.query('COMMIT');
      return receipt.receiptId;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async getReceipt(ownerId: string, receiptId: string, privateDetails = false): Promise<ShareableReceipt | FinalReceipt | undefined> {
    const result = await this.pool.query<{ public_receipt: ShareableReceipt; encrypted_private_receipt: Buffer }>(`SELECT r.public_receipt,r.encrypted_private_receipt FROM receipts r JOIN orders o ON o.order_id=r.order_id WHERE r.receipt_id=$1 AND o.owner_session_hash=$2`, [receiptId, ownerHash(ownerId)]);
    const row = result.rows[0]; if (!row) return undefined;
    return privateDetails ? this.encryption.decrypt<FinalReceipt>(row.encrypted_private_receipt, receiptContext(receiptId)) : row.public_receipt;
  }

  async verifyReceiptAuthenticity(receiptId: string, verifier: ReceiptVerifier): Promise<{ authentic: true; orderId: string }> {
    const result = await this.pool.query<{ order_id: string; encrypted_private_receipt: Buffer; authenticity_hmac: Buffer | null }>('SELECT order_id,encrypted_private_receipt,authenticity_hmac FROM receipts WHERE receipt_id=$1', [receiptId]);
    const row = result.rows[0]; if (!row || !row.authenticity_hmac) throw new Error('Authenticated receipt not found');
    const receipt = this.encryption.decrypt<FinalReceipt>(row.encrypted_private_receipt, receiptContext(receiptId));
    if (receipt.receiptId !== receiptId || receipt.orderId !== row.order_id) throw new Error('Receipt identity binding is invalid');
    await verifier(canonicalReceipt(receipt), row.authenticity_hmac.toString('hex'));
    return { authentic: true, orderId: row.order_id };
  }

  async expire(orderId: string, now = Date.now()): Promise<void> { await this.transition(orderId, 'SYSTEM', undefined, 'ORDER_EXPIRED', now, order => expireOrder(order, now)); }
  async setUnresolved(orderId: string, operatorId: string, reason: string, now = Date.now()): Promise<void> { await this.transition(orderId, 'OPERATOR', operatorId, 'ORDER_MARKED_UNRESOLVED', now, order => markUnresolved(order, reason)); }

  async timeline(ownerId: string, orderId: string): Promise<Array<{ type: string; at: string; actor: string; details: Record<string, unknown> }>> {
    const result = await this.pool.query<{ event_type: string; occurred_at: Date; actor_type: string; details: Record<string, unknown> }>(`SELECT a.event_type,a.occurred_at,a.actor_type,a.details FROM audit_events a JOIN orders o ON o.order_id=a.order_id WHERE a.order_id=$1 AND o.owner_session_hash=$2 ORDER BY a.event_id`, [orderId, ownerHash(ownerId)]);
    return result.rows.map(row => ({ type: row.event_type, at: row.occurred_at.toISOString(), actor: row.actor_type, details: row.details }));
  }

  async operatorSnapshot() {
    const [orders, allocations, evidence] = await Promise.all([
      this.pool.query<{ order_id: string; status: PaymentOrder['status']; created_at: Date; expires_at: Date; public_view: Record<string, unknown> }>('SELECT order_id,status,created_at,expires_at,public_view FROM orders ORDER BY created_at'),
      this.pool.query<{ allocation_id: string; order_id: string; authorization_id: string; journal_phase: string; rpc_attempt_count: number; last_error_code: string | null; updated_at: Date }>('SELECT allocation_id,order_id,authorization_id,journal_phase,rpc_attempt_count,last_error_code,updated_at FROM address_allocation_journal ORDER BY created_at'),
      this.pool.query<{ count: string }>('SELECT count(*)::text AS count FROM replay_references'),
    ]);
    return {
      orders: orders.rows.map(row => ({ id: row.order_id, status: row.status, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), payoutAuthorizationState: ((row.public_view.payoutAuthorization as { state?: string } | undefined)?.state ?? 'NOT_REQUESTED') })),
      allocationCounts: { available: 0, assigned: allocations.rows.filter(row => ['RESERVED','ACTIVATED'].includes(row.journal_phase)).length },
      pendingAllocationOperations: allocations.rows.filter(row => !['RESERVED','ACTIVATED','CANCELLED'].includes(row.journal_phase)).map(row => ({ allocationId: row.allocation_id, orderId: row.order_id, authorizationId: row.authorization_id, phase: row.journal_phase, rpcAttemptCount: row.rpc_attempt_count, lastErrorCode: row.last_error_code, updatedAt: row.updated_at.toISOString() })),
      replayReferenceCount: Number(evidence.rows[0]?.count ?? 0),
    };
  }

  private privateOrder(row: OrderRow): PaymentOrder { return this.encryption.decrypt<PaymentOrder>(row.encrypted_private_state, orderContext(row.order_id)); }
  private async readOrder(orderId: string): Promise<OrderRow> { const result = await this.pool.query<OrderRow>('SELECT * FROM orders WHERE order_id=$1', [orderId]); if (!result.rows[0]) throw new Error('Order not found'); return result.rows[0]; }
  private async lockOrder(client: PoolClient, orderId: string): Promise<OrderRow> { const result = await client.query<OrderRow>('SELECT * FROM orders WHERE order_id=$1 FOR UPDATE', [orderId]); if (!result.rows[0]) throw new Error('Order not found'); return result.rows[0]; }
  private async updateOrder(client: PoolClient, row: OrderRow, order: PaymentOrder, now: number): Promise<void> {
    const result = await client.query(`UPDATE orders SET status=$2,public_view=$3,encrypted_private_state=$4,encryption_key_version=$5,state_version=state_version+1,updated_at=$6 WHERE order_id=$1 AND state_version=$7`, [row.order_id, order.status, publicOrder(order), this.encryption.encrypt(order, orderContext(row.order_id)), this.encryption.activeVersion, new Date(now), row.state_version]);
    if (result.rowCount !== 1) throw new Error('Concurrent order update rejected');
  }
  private async syncRequestStatus(client: PoolClient, orderId: string, status: PaymentOrder['status'], now: number): Promise<void> { await client.query('UPDATE public_order_requests SET status=$2,updated_at=$3 WHERE request_id=$1', [orderId, status === 'AWAITING_PAYMENT' ? 'PAYMENT_READY' : status, new Date(now)]); }
  private allocationOperation(record: { allocation_id: string; authorization_id: string; journal_phase: AddressAllocationPhase; encrypted_derivation: Buffer; encrypted_receiver: Buffer | null; rpc_attempt_count: number }, order: Pick<OrderRow, 'order_id' | 'accepted_by'>, operatorId: string): AddressAllocationOperation {
    if (order.accepted_by !== operatorId) throw new Error('Operator identity does not match the accepted order');
    const derivation = this.encryption.decrypt<{ diversifierIndex: string }>(record.encrypted_derivation, `allocation:${record.allocation_id}:derivation`);
    const receiver = record.encrypted_receiver ? this.encryption.decrypt<{ receiver: string; diversifierIndex: string }>(record.encrypted_receiver, `allocation:${record.allocation_id}:receiver`) : undefined;
    if (!/^\d+$/.test(derivation.diversifierIndex) || (receiver && receiver.diversifierIndex !== derivation.diversifierIndex)) throw new Error('Allocation recovery record is inconsistent');
    return {
      allocationId: record.allocation_id, authorizationId: record.authorization_id, orderId: order.order_id,
      operatorId, diversifierIndex: BigInt(derivation.diversifierIndex).toString(), phase: record.journal_phase,
      rpcAttemptCount: record.rpc_attempt_count, ...(receiver ? { address: receiver.receiver } : {}),
    };
  }
  private async validateAcceptedOrder(client: PoolClient, order: OrderRow, operatorId: string, now: number): Promise<void> {
    if (order.accepted_by !== operatorId) throw new Error('Operator identity does not match the accepted order');
    const requestResult = await client.query<{ owner_session_hash: Buffer; status: string; linked_order_id: string; destination_recipient: string; immutable_terms: typeof PUBLIC_ROUTE_TERMS; expires_at: Date }>(`SELECT owner_session_hash,status,linked_order_id,destination_recipient,immutable_terms,expires_at FROM public_order_requests WHERE request_id=$1 FOR UPDATE`, [order.order_id]);
    const request = requestResult.rows[0]; const manifest = order.immutable_manifest.binding;
    if (!request || request.status !== 'ACCEPTED' || request.linked_order_id !== order.order_id || !request.owner_session_hash.equals(order.owner_session_hash)) throw new Error('Accepted order owner or request binding is invalid');
    if (order.immutable_manifest.requestId !== order.order_id || manifest.orderId !== order.order_id) throw new Error('Order manifest identity mismatch');
    if (request.destination_recipient.toLowerCase() !== manifest.destinationRecipient.toLowerCase() || request.expires_at.toISOString() !== manifest.expiresAt || !isDeepStrictEqual(request.immutable_terms, PUBLIC_ROUTE_TERMS)) throw new Error('Accepted order terms do not match the immutable request');
    validateOperatorOrderBinding(manifest, now);
  }
  private async verifyAuthorization(client: PoolClient, order: OrderRow, kind: AuthorizationKind, authorizationId: string, operatorId: string, verifier: AuthorizationVerifier, allowedStates: string[], now: number) {
    const result = await client.query<{ state: string; operator_id: string; expires_at: Date; target: string; signed_payload: Record<string, unknown>; signature: Buffer; manifest_fingerprint: Buffer }>(`SELECT state,operator_id,expires_at,target,signed_payload,signature,manifest_fingerprint FROM authorization_records WHERE authorization_id=$1 AND order_id=$2 AND kind=$3 FOR UPDATE`, [authorizationId, order.order_id, kind]);
    const authorization = result.rows[0]; if (!authorization) throw new Error('Operator authorization not found');
    if (!allowedStates.includes(authorization.state) || authorization.operator_id !== operatorId) throw new Error('Operator authorization is no longer usable or has the wrong identity');
    if (authorization.state === 'ISSUED' && authorization.expires_at.getTime() <= now) throw new Error('Operator authorization has expired before the operation began');
    const manifestFingerprint = createHash('sha256').update(JSON.stringify(order.immutable_manifest)).digest();
    if (!manifestFingerprint.equals(authorization.manifest_fingerprint)) throw new Error('Operator authorization manifest binding is invalid');
    const payload = authorization.signed_payload;
    if (payload.authorizationId !== authorizationId || payload.orderId !== order.order_id || payload.kind !== kind || payload.operatorId !== operatorId
      || payload.manifestFingerprint !== manifestFingerprint.toString('hex') || payload.expiresAt !== authorization.expires_at.toISOString()
      || authorization.target !== `order:${order.order_id}`) throw new Error('Operator authorization signed payload does not match its database scope');
    await verifier(authorizationDomain(kind), canonicalAuthorization(payload), authorization.signature.toString('hex'));
    return authorization;
  }
  private async startAllocationAuthorization(client: PoolClient, order: OrderRow, authorizationId: string, operatorId: string, verifier: AuthorizationVerifier, now: number): Promise<void> {
    await this.verifyAuthorization(client, order, 'ADDRESS_ALLOCATION', authorizationId, operatorId, verifier, ['ISSUED'], now);
    const started = await client.query(`UPDATE authorization_records SET state='IN_PROGRESS',updated_at=$2 WHERE authorization_id=$1 AND state='ISSUED'`, [authorizationId, new Date(now)]);
    if (started.rowCount !== 1) throw new Error('Operator authorization was already started');
  }
  private async consumeAuthorization(client: PoolClient, order: OrderRow, kind: AuthorizationKind, authorizationId: string, operatorId: string, verifier: AuthorizationVerifier, now: number): Promise<void> {
    await this.verifyAuthorization(client, order, kind, authorizationId, operatorId, verifier, ['ISSUED'], now);
    const consumed = await client.query(`UPDATE authorization_records SET state='CONSUMED',consumed_at=$2,updated_at=$2 WHERE authorization_id=$1 AND state='ISSUED'`, [authorizationId, new Date(now)]);
    if (consumed.rowCount !== 1) throw new Error('Operator authorization was already consumed');
  }
  private async transition(orderId: string, actorType: 'SYSTEM' | 'OPERATOR', actorId: string | undefined, event: string, now: number, change: (order: PaymentOrder) => PaymentOrder): Promise<void> {
    const client = await this.pool.connect(); try { await client.query('BEGIN'); const row = await this.lockOrder(client, orderId); const next = change(this.privateOrder(row)); await this.updateOrder(client, row, next, now); await this.syncRequestStatus(client, orderId, next.status, now); await this.audit(client, orderId, actorType, actorId, event, {}); await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  private async audit(client: PoolClient, orderId: string, actorType: 'SYSTEM' | 'USER' | 'OPERATOR' | 'VERIFIER', actorId: string | undefined, eventType: string, details: Record<string, unknown>): Promise<void> { await client.query(`INSERT INTO audit_events(order_id,actor_type,actor_fingerprint,event_type,details) VALUES($1,$2,$3,$4,$5)`, [orderId, actorType, actorId ? fingerprint(actorId) : null, eventType, details]); }
}
