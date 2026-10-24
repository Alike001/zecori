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
  status: PaymentOrder['status']; state_version: string; created_at: Date; expires_at: Date;
};

export type PendingRequest = {
  requestId: string; createdAt: string; expiresAt: string; destinationRecipient: string;
  terms: typeof PUBLIC_ROUTE_TERMS;
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
    const result = await this.pool.query("SELECT version FROM schema_migrations WHERE version = ANY($1::text[])", [['002_settlement_integration', '003_private_verification_relay']]);
    if (result.rowCount !== 2) throw new Error('Settlement or private relay migration is missing');
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

  async reserveValidatedAllocation(orderId: string, operatorId: string, authorizationId: string, verifier: AuthorizationVerifier, candidate: ValidatedReceivingAddress, now = Date.now()): Promise<string> {
    if (candidate.state !== 'AVAILABLE') throw new Error('Allocation must be independently validated as available');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.lockOrder(client, orderId);
      if (row.status !== 'CREATED') throw new Error('Order is not awaiting allocation');
      await this.consumeAuthorization(client, row, 'ADDRESS_ALLOCATION', authorizationId, operatorId, verifier, now);
      const manifest = row.immutable_manifest.binding;
      if (manifest.orderId !== orderId) throw new Error('Order manifest identity mismatch');
      const order = createOrder({ allocationId: candidate.allocationId, destinationRecipient: manifest.destinationRecipient, sourceAmountZat: manifest.sourceAmountZat, expiresAt: manifest.expiresAt, providerId: manifest.providerId }, {
        allocationId: candidate.allocationId, sourceReceiver: candidate.address, sourceDiversifierIndex: candidate.diversifierIndex, sourceNotBeforeHeight: candidate.sourceNotBeforeHeight,
      }, row.created_at.getTime(), orderId);
      const encryptedReceiver = this.encryption.encrypt({ receiver: candidate.address, diversifierIndex: candidate.diversifierIndex }, `allocation:${candidate.allocationId}:receiver`);
      await client.query(`INSERT INTO address_allocation_journal
        (allocation_id, order_id, address_fingerprint, diversifier_fingerprint, encrypted_receiver, encryption_key_version, source_not_before_height, journal_phase, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'RESERVED',$8,$8)`, [candidate.allocationId, orderId, fingerprint(candidate.address), fingerprint(candidate.diversifierIndex), encryptedReceiver, this.encryption.activeVersion, candidate.sourceNotBeforeHeight, new Date(now)]);
      await this.updateOrder(client, row, order, now);
      await this.audit(client, orderId, 'OPERATOR', operatorId, 'ALLOCATION_RESERVED', { allocationId: candidate.allocationId, authorizationId, validation: 'independent-wallet-rpc' });
      await client.query('COMMIT');
      return candidate.allocationId;
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
      this.pool.query<{ journal_phase: string; count: string }>('SELECT journal_phase,count(*)::text AS count FROM address_allocation_journal GROUP BY journal_phase'),
      this.pool.query<{ count: string }>('SELECT count(*)::text AS count FROM replay_references'),
    ]);
    return { orders: orders.rows.map(row => ({ id: row.order_id, status: row.status, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), payoutAuthorizationState: ((row.public_view.payoutAuthorization as { state?: string } | undefined)?.state ?? 'NOT_REQUESTED') })), allocationCounts: { available: 0, assigned: allocations.rows.reduce((sum, row) => sum + Number(row.count), 0) }, replayReferenceCount: Number(evidence.rows[0]?.count ?? 0) };
  }

  private privateOrder(row: OrderRow): PaymentOrder { return this.encryption.decrypt<PaymentOrder>(row.encrypted_private_state, orderContext(row.order_id)); }
  private async readOrder(orderId: string): Promise<OrderRow> { const result = await this.pool.query<OrderRow>('SELECT * FROM orders WHERE order_id=$1', [orderId]); if (!result.rows[0]) throw new Error('Order not found'); return result.rows[0]; }
  private async lockOrder(client: PoolClient, orderId: string): Promise<OrderRow> { const result = await client.query<OrderRow>('SELECT * FROM orders WHERE order_id=$1 FOR UPDATE', [orderId]); if (!result.rows[0]) throw new Error('Order not found'); return result.rows[0]; }
  private async updateOrder(client: PoolClient, row: OrderRow, order: PaymentOrder, now: number): Promise<void> {
    const result = await client.query(`UPDATE orders SET status=$2,public_view=$3,encrypted_private_state=$4,encryption_key_version=$5,state_version=state_version+1,updated_at=$6 WHERE order_id=$1 AND state_version=$7`, [row.order_id, order.status, publicOrder(order), this.encryption.encrypt(order, orderContext(row.order_id)), this.encryption.activeVersion, new Date(now), row.state_version]);
    if (result.rowCount !== 1) throw new Error('Concurrent order update rejected');
  }
  private async syncRequestStatus(client: PoolClient, orderId: string, status: PaymentOrder['status'], now: number): Promise<void> { await client.query('UPDATE public_order_requests SET status=$2,updated_at=$3 WHERE request_id=$1', [orderId, status === 'AWAITING_PAYMENT' ? 'PAYMENT_READY' : status, new Date(now)]); }
  private async consumeAuthorization(client: PoolClient, order: OrderRow, kind: AuthorizationKind, authorizationId: string, operatorId: string, verifier: AuthorizationVerifier, now: number): Promise<void> {
    const result = await client.query<{ state: string; operator_id: string; expires_at: Date; signed_payload: Record<string, unknown>; signature: Buffer; manifest_fingerprint: Buffer }>(`SELECT state,operator_id,expires_at,signed_payload,signature,manifest_fingerprint FROM authorization_records WHERE authorization_id=$1 AND order_id=$2 AND kind=$3 FOR UPDATE`, [authorizationId, order.order_id, kind]);
    const authorization = result.rows[0]; if (!authorization) throw new Error('Operator authorization not found');
    if (authorization.state !== 'ISSUED' || authorization.operator_id !== operatorId) throw new Error('Operator authorization is no longer usable or has the wrong identity');
    if (authorization.expires_at.getTime() <= now) throw new Error('Operator authorization has expired');
    const manifestFingerprint = createHash('sha256').update(JSON.stringify(order.immutable_manifest)).digest();
    if (!manifestFingerprint.equals(authorization.manifest_fingerprint)) throw new Error('Operator authorization manifest binding is invalid');
    await verifier(authorizationDomain(kind), canonicalAuthorization(authorization.signed_payload), authorization.signature.toString('hex'));
    const consumed = await client.query(`UPDATE authorization_records SET state='CONSUMED',consumed_at=$2,updated_at=$2 WHERE authorization_id=$1 AND state='ISSUED'`, [authorizationId, new Date(now)]);
    if (consumed.rowCount !== 1) throw new Error('Operator authorization was already consumed');
  }
  private async transition(orderId: string, actorType: 'SYSTEM' | 'OPERATOR', actorId: string | undefined, event: string, now: number, change: (order: PaymentOrder) => PaymentOrder): Promise<void> {
    const client = await this.pool.connect(); try { await client.query('BEGIN'); const row = await this.lockOrder(client, orderId); const next = change(this.privateOrder(row)); await this.updateOrder(client, row, next, now); await this.syncRequestStatus(client, orderId, next.status, now); await this.audit(client, orderId, actorType, actorId, event, {}); await client.query('COMMIT'); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  private async audit(client: PoolClient, orderId: string, actorType: 'SYSTEM' | 'USER' | 'OPERATOR' | 'VERIFIER', actorId: string | undefined, eventType: string, details: Record<string, unknown>): Promise<void> { await client.query(`INSERT INTO audit_events(order_id,actor_type,actor_fingerprint,event_type,details) VALUES($1,$2,$3,$4,$5)`, [orderId, actorType, actorId ? fingerprint(actorId) : null, eventType, details]); }
}
