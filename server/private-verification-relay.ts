import { createHash, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { PaymentOrder } from '../src/lib/order-coordinator.ts';
import { DataEncryption } from './data-encryption.ts';
import {
  relayFingerprint, signRelayChallenge, verifyRelayChallenge, verifyRelayEvidence,
  type RelayChallengePayload, type RelayPhase, type SignedRelayChallenge, type SignedRelayEvidence,
} from './private-verification-protocol.ts';

type JobRow = {
  job_id: string; order_id: string; verifier_id: string; phase: RelayPhase; state: string;
  manifest_fingerprint: Buffer; request_fingerprint: Buffer; encrypted_challenge: Buffer;
  expires_at: Date; lease_expires_at: Date | null;
};

function orderContext(id: string): string { return `order:${id}:private-state`; }
function challengeContext(id: string): string { return `relay-job:${id}:challenge`; }
function messageContext(id: string): string { return `relay-job:${id}:evidence`; }
function digest(value: string): Buffer { return createHash('sha256').update(value).digest(); }

export class PrivateVerificationRelay {
  private readonly pool: Pool;
  private readonly relayEncryption: DataEncryption;
  private readonly orderEncryption: DataEncryption;
  private readonly coordinatorPrivateKey?: KeyObject | string | Buffer;
  private readonly verifierPublicKeys: ReadonlyMap<string, KeyObject | string | Buffer>;
  constructor(
    pool: Pool,
    relayEncryption: DataEncryption,
    coordinatorPrivateKey: KeyObject | string | Buffer | undefined,
    verifierPublicKeys: ReadonlyMap<string, KeyObject | string | Buffer>,
    orderEncryption: DataEncryption = relayEncryption,
  ) { this.pool = pool; this.relayEncryption = relayEncryption; this.orderEncryption = orderEncryption; this.coordinatorPrivateKey = coordinatorPrivateKey; this.verifierPublicKeys = verifierPublicKeys; }

  async createSourceJob(input: { orderId: string; transactionId: string; phase: RelayPhase; verifierId: string }, now = Date.now(), lifetimeMs = 120_000): Promise<string> {
    if (!this.verifierPublicKeys.has(input.verifierId)) throw new Error('Verifier identity is not registered');
    if (!this.coordinatorPrivateKey) throw new Error('Coordinator signing identity is unavailable');
    if (!/^[0-9a-f]{64}$/i.test(input.transactionId)) throw new Error('Source transaction ID must be complete');
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 30_000 || lifetimeMs > 300_000) throw new Error('Relay job lifetime is invalid');
    const result = await this.pool.query<{ immutable_manifest: Record<string, unknown>; encrypted_private_state: Buffer; status: string }>('SELECT immutable_manifest,encrypted_private_state,status FROM orders WHERE order_id=$1', [input.orderId]);
    const row = result.rows[0]; if (!row) throw new Error('Order not found');
    const order = this.orderEncryption.decrypt<PaymentOrder>(row.encrypted_private_state, orderContext(input.orderId));
    if (input.phase === 'SOURCE_DETECTION' && order.status !== 'AWAITING_PAYMENT') throw new Error('Order is not awaiting source detection');
    if (input.phase === 'SOURCE_CONFIRMATION' && (order.status !== 'SOURCE_DETECTED' || order.sourceReceipt?.transactionId !== input.transactionId.toLowerCase())) throw new Error('Order is not awaiting confirmation of this source transaction');
    const request = {
      orderId: input.orderId, transactionId: input.transactionId.toLowerCase(), receiver: order.sourceReceiver,
      amountZatoshis: order.sourceAmountZat, expectedDiversifierIndex: order.sourceDiversifierIndex,
      minimumBlockHeight: order.sourceNotBeforeHeight, minimumBlockTime: Math.floor(Date.parse(order.createdAt) / 1000),
      requiredPool: 'ironwood' as const, minimumConfirmations: input.phase === 'SOURCE_DETECTION' ? 1 : order.sourceMinimumConfirmations,
    };
    const jobId = randomUUID(); const issuedAt = new Date(now).toISOString(); const expiresAt = new Date(now + lifetimeMs).toISOString();
    const payload: RelayChallengePayload = { version: 1, jobId, verifierId: input.verifierId, phase: input.phase, nonce: randomBytes(32).toString('hex'), orderId: input.orderId, manifestFingerprint: relayFingerprint(row.immutable_manifest), request, issuedAt, expiresAt };
    const challenge = signRelayChallenge(payload, this.coordinatorPrivateKey);
    await this.pool.query(`INSERT INTO private_verification_jobs
      (job_id,order_id,verifier_id,phase,manifest_fingerprint,request_fingerprint,challenge_nonce,encrypted_challenge,encryption_key_version,coordinator_signature_fingerprint,state,issued_at,expires_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING',$11,$12,$11)`, [
      jobId, input.orderId, input.verifierId, input.phase, Buffer.from(payload.manifestFingerprint, 'hex'), Buffer.from(relayFingerprint(request), 'hex'), Buffer.from(payload.nonce, 'hex'),
      this.relayEncryption.encrypt(challenge, challengeContext(jobId)), this.relayEncryption.activeVersion, digest(challenge.coordinatorSignature), new Date(now), new Date(now + lifetimeMs),
    ]);
    return jobId;
  }

  async claim(verifierId: string, now = Date.now(), leaseMs = 60_000): Promise<SignedRelayChallenge | undefined> {
    if (!this.verifierPublicKeys.has(verifierId)) throw new Error('Verifier identity is not registered');
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 10_000 || leaseMs > 120_000) throw new Error('Relay lease is invalid');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE private_verification_jobs SET state='EXPIRED',updated_at=$1 WHERE verifier_id=$2 AND state IN ('PENDING','DISPATCHED') AND expires_at <= $1`, [new Date(now), verifierId]);
      const selected = await client.query<JobRow>(`SELECT * FROM private_verification_jobs WHERE verifier_id=$1 AND expires_at>$2 AND (state='PENDING' OR (state='DISPATCHED' AND lease_expires_at<=$2)) ORDER BY issued_at FOR UPDATE SKIP LOCKED LIMIT 1`, [verifierId, new Date(now)]);
      const row = selected.rows[0];
      if (!row) { await client.query('COMMIT'); return undefined; }
      await client.query(`UPDATE private_verification_jobs SET state='DISPATCHED',attempts=attempts+1,lease_expires_at=$2,updated_at=$3 WHERE job_id=$1`, [row.job_id, new Date(now + leaseMs), new Date(now)]);
      await client.query('COMMIT');
      return this.relayEncryption.decrypt<SignedRelayChallenge>(row.encrypted_challenge, challengeContext(row.job_id));
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async submit(envelope: SignedRelayEvidence, now = Date.now()): Promise<'RECEIVED' | 'UNRESOLVED'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<JobRow>('SELECT * FROM private_verification_jobs WHERE job_id=$1 FOR UPDATE', [envelope.payload.jobId]);
      const row = selected.rows[0]; if (!row) throw new Error('Relay job not found');
      if (!['PENDING', 'DISPATCHED'].includes(row.state)) throw new Error('Relay job is no longer accepting evidence');
      const verifierKey = this.verifierPublicKeys.get(row.verifier_id); if (!verifierKey) throw new Error('Verifier identity is no longer registered');
      const challenge = this.relayEncryption.decrypt<SignedRelayChallenge>(row.encrypted_challenge, challengeContext(row.job_id));
      verifyRelayEvidence(envelope, challenge, verifierKey, now);
      const manifest = await client.query<{ immutable_manifest: Record<string, unknown> }>('SELECT immutable_manifest FROM orders WHERE order_id=$1 FOR SHARE', [row.order_id]);
      if (!manifest.rows[0] || relayFingerprint(manifest.rows[0].immutable_manifest) !== envelope.payload.manifestFingerprint) throw new Error('Current order manifest does not match relay evidence');
      const state = envelope.payload.outcome === 'VERIFIED' ? 'RECEIVED' : 'UNRESOLVED';
      await client.query(`INSERT INTO private_verification_messages(message_id,job_id,order_id,verifier_id,outcome,signature_fingerprint,encrypted_envelope,encryption_key_version,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), row.job_id, row.order_id, row.verifier_id, envelope.payload.outcome, digest(envelope.verifierSignature), this.relayEncryption.encrypt(envelope, messageContext(row.job_id)), this.relayEncryption.activeVersion, new Date(now)]);
      await client.query(`UPDATE private_verification_jobs SET state=$2,received_at=$3,lease_expires_at=NULL,unresolved_reason=$4,updated_at=$3 WHERE job_id=$1`, [row.job_id, state, new Date(now), envelope.payload.reasonCode ?? null]);
      await client.query(`INSERT INTO audit_events(order_id,actor_type,actor_fingerprint,event_type,details) VALUES($1,'VERIFIER',$2,$3,$4)`, [row.order_id, digest(row.verifier_id), state === 'RECEIVED' ? 'PRIVATE_VERIFICATION_EVIDENCE_RECEIVED' : 'PRIVATE_VERIFICATION_UNRESOLVED', { jobId: row.job_id, phase: row.phase, reasonCode: envelope.payload.reasonCode }]);
      await client.query('COMMIT'); return state;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async received(jobId: string): Promise<SignedRelayEvidence> {
    const result = await this.pool.query<{ state: string; encrypted_envelope: Buffer }>(`SELECT j.state,m.encrypted_envelope FROM private_verification_jobs j JOIN private_verification_messages m USING(job_id) WHERE j.job_id=$1`, [jobId]);
    const row = result.rows[0]; if (!row || row.state !== 'RECEIVED') throw new Error('Verified relay evidence is not ready to apply');
    return this.relayEncryption.decrypt<SignedRelayEvidence>(row.encrypted_envelope, messageContext(jobId));
  }

  async message(jobId: string): Promise<SignedRelayEvidence> {
    const result = await this.pool.query<{ state: string; encrypted_envelope: Buffer }>(`SELECT j.state,m.encrypted_envelope FROM private_verification_jobs j JOIN private_verification_messages m USING(job_id) WHERE j.job_id=$1`, [jobId]);
    const row = result.rows[0]; if (!row || !['RECEIVED', 'UNRESOLVED'].includes(row.state)) throw new Error('Relay response is not ready to apply');
    return this.relayEncryption.decrypt<SignedRelayEvidence>(row.encrypted_envelope, messageContext(jobId));
  }

  async verifiedMessage(jobId: string, coordinatorPublicKey: KeyObject | string | Buffer, now = Date.now()): Promise<SignedRelayEvidence> {
    const result = await this.pool.query<{ verifier_id: string; state: string; encrypted_challenge: Buffer; encrypted_envelope: Buffer }>(`SELECT j.verifier_id,j.state,j.encrypted_challenge,m.encrypted_envelope FROM private_verification_jobs j JOIN private_verification_messages m USING(job_id) WHERE j.job_id=$1`, [jobId]);
    const row = result.rows[0]; if (!row || !['RECEIVED', 'UNRESOLVED'].includes(row.state)) throw new Error('Relay response is not ready to apply');
    const verifierKey = this.verifierPublicKeys.get(row.verifier_id); if (!verifierKey) throw new Error('Verifier identity is not registered for application');
    const challenge = this.relayEncryption.decrypt<SignedRelayChallenge>(row.encrypted_challenge, challengeContext(jobId));
    const envelope = this.relayEncryption.decrypt<SignedRelayEvidence>(row.encrypted_envelope, messageContext(jobId));
    verifyRelayChallenge(challenge, coordinatorPublicKey, row.verifier_id, now);
    verifyRelayEvidence(envelope, challenge, verifierKey, now);
    return envelope;
  }

  async markApplied(client: PoolClient, jobId: string, now = Date.now()): Promise<void> {
    const result = await client.query(`UPDATE private_verification_jobs SET state='APPLIED',applied_at=$2,updated_at=$2 WHERE job_id=$1 AND state='RECEIVED'`, [jobId, new Date(now)]);
    if (result.rowCount !== 1) throw new Error('Relay evidence is not in the received state');
  }
}
