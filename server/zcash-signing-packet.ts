import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool } from 'pg';
import type { PaymentOrder } from '../src/lib/order-coordinator.ts';
import { zatoshisToZec } from '../src/lib/order-coordinator.ts';
import { DataEncryption } from './data-encryption.ts';
import { SOURCE_FEE_RESERVE_ZATOSHIS, SOURCE_PAYMENT_ZATOSHIS, type SourceWalletHealth } from './zcash-source-wallet.ts';

export const WALLET_A_SEND_RPC_METHOD = 'z_sendmany' as const;
export type SourcePaymentOperationState = 'PREPARED' | 'SUBMISSION_STARTED' | 'OPID_RECORDED' | 'SUBMISSION_AMBIGUOUS' | 'TXID_RECORDED' | 'RECOVERY_REQUIRED' | 'CANCELLED';

export type WalletASigningPacket = Readonly<{
  version: 2; orderId: string; allocationId: string; sourceDiversifierIndex: string; sourceNotBeforeHeight: number;
  walletName: string; receiver: string; sourceAmountZatoshis: '1000000'; sourceAmountZec: '0.01';
  minimumConfirmations: 10; privacyPolicy: 'FullPrivacy'; memo: 'OMITTED';
  feeMode: 'ZIP-317-wallet-computed'; feeReserveZatoshis: '10000'; expiresAt: string;
  rpcMethod: typeof WALLET_A_SEND_RPC_METHOD;
  rpcParams: readonly ['ANY_ORCHARD', readonly [{ address: string; amount: 0.01 }], 10, null, 'FullPrivacy'];
  packetDigest: string; inputEligibility: 'confirmed-safe-spendable-ironwood-only-no-legacy-orchard';
}>;

export type SourcePaymentOperation = Readonly<{
  operationId: string; orderId: string; state: SourcePaymentOperationState; packet: WalletASigningPacket;
  opid?: string; txid?: string; recoveryReason?: string; submissionStartedAt?: string; createdAt: string; updatedAt: string;
}>;

function canonical(value: Record<string, unknown>): string { return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))); }
function digest(packet: Omit<WalletASigningPacket, 'packetDigest'>): string { return createHash('sha256').update(canonical(packet)).digest('hex'); }

export function assertWalletASigningPacket(packet: WalletASigningPacket, order?: PaymentOrder, now = Date.now()): void {
  const { packetDigest, ...visible } = packet;
  if (!/^[0-9a-f]{64}$/.test(packetDigest) || digest(visible) !== packetDigest) throw new Error('Source signing packet digest does not match its immutable fields');
  if (packet.version !== 2 || packet.rpcMethod !== WALLET_A_SEND_RPC_METHOD || packet.sourceAmountZatoshis !== '1000000'
    || packet.sourceAmountZec !== '0.01' || packet.minimumConfirmations !== 10 || packet.privacyPolicy !== 'FullPrivacy'
    || packet.memo !== 'OMITTED' || packet.feeMode !== 'ZIP-317-wallet-computed' || packet.feeReserveZatoshis !== '10000'
    || !isDeepStrictEqual(packet.rpcParams, ['ANY_ORCHARD', [{ address: packet.receiver, amount: 0.01 }], 10, null, 'FullPrivacy'])) {
    throw new Error('Source signing packet does not match the exact reviewed 0.01 TAZ no-memo request');
  }
  const deadline = Date.parse(packet.expiresAt);
  if (!Number.isFinite(deadline) || deadline <= now) throw new Error('Source signing packet payment deadline has expired or is invalid');
  if (order && (order.id !== packet.orderId || order.status !== 'AWAITING_PAYMENT' || order.allocationId !== packet.allocationId
    || order.sourceReceiver !== packet.receiver || order.sourceDiversifierIndex !== packet.sourceDiversifierIndex
    || order.sourceNotBeforeHeight !== packet.sourceNotBeforeHeight || order.sourceAmountZat !== packet.sourceAmountZatoshis
    || order.sourcePool !== 'ironwood' || order.sourceMinimumConfirmations !== packet.minimumConfirmations || order.expiresAt !== packet.expiresAt)) {
    throw new Error('Source signing packet does not match the exact immutable PAYMENT_READY order');
  }
}

export function prepareWalletASigningPacket(order: PaymentOrder, wallet: SourceWalletHealth, now = Date.now(), feeReserveZatoshis = SOURCE_FEE_RESERVE_ZATOSHIS): WalletASigningPacket {
  if (order.status !== 'AWAITING_PAYMENT' || Date.parse(order.expiresAt) <= now) throw new Error('Order is not in an active source-payment window');
  if (order.sourceAmountZat !== SOURCE_PAYMENT_ZATOSHIS.toString()) throw new Error('Wallet A can prepare only the exact 1,000,000-zatoshi fixed route');
  if (order.sourcePool !== 'ironwood' || order.sourceMinimumConfirmations !== 10) throw new Error('Order does not require the reviewed ten-confirmation Ironwood source');
  if (!wallet.locked || !wallet.synchronized || !wallet.historyComplete || !wallet.walletOwned || wallet.minimumConfirmations !== 10) throw new Error('Wallet A is not locked, synchronized, owned, and ten-confirmation ready');
  if (feeReserveZatoshis !== SOURCE_FEE_RESERVE_ZATOSHIS) throw new Error('The reviewed ZIP-317 fee reserve must remain exactly 10,000 zatoshis');
  const ironwood = BigInt(wallet.poolZatoshis.ironwood ?? '0'); const legacyOrchard = BigInt(wallet.poolZatoshis.orchard ?? '0');
  if (legacyOrchard !== 0n) throw new Error('ANY_ORCHARD is a shielded-family selector; eligible legacy Orchard notes must be zero before this Ironwood-only send');
  if (ironwood < SOURCE_PAYMENT_ZATOSHIS + feeReserveZatoshis || !wallet.fullPrivacyCompatible) throw new Error('Confirmed Ironwood value is insufficient for the exact payment and reviewed fee reserve');
  if (zatoshisToZec(order.sourceAmountZat) !== '0.01') throw new Error('Source amount cannot be represented as the exact reviewed zecd JSON amount');
  const visible: Omit<WalletASigningPacket, 'packetDigest'> = {
    version: 2, orderId: order.id, allocationId: order.allocationId, sourceDiversifierIndex: order.sourceDiversifierIndex,
    sourceNotBeforeHeight: order.sourceNotBeforeHeight, walletName: wallet.walletName, receiver: order.sourceReceiver,
    sourceAmountZatoshis: '1000000', sourceAmountZec: '0.01', minimumConfirmations: 10, privacyPolicy: 'FullPrivacy',
    memo: 'OMITTED', feeMode: 'ZIP-317-wallet-computed', feeReserveZatoshis: '10000', expiresAt: order.expiresAt,
    rpcMethod: WALLET_A_SEND_RPC_METHOD, rpcParams: ['ANY_ORCHARD', [{ address: order.sourceReceiver, amount: 0.01 }], 10, null, 'FullPrivacy'],
    inputEligibility: 'confirmed-safe-spendable-ironwood-only-no-legacy-orchard',
  };
  return Object.freeze({ ...visible, packetDigest: digest(visible) });
}

type OperationRow = { operation_id: string; order_id: string; packet_digest: Buffer; encrypted_packet: Buffer; state: SourcePaymentOperationState;
  encrypted_opid: Buffer | null; encrypted_txid: Buffer | null; recovery_reason: string | null; submission_started_at: Date | null; created_at: Date; updated_at: Date };

export class PostgresSourcePaymentOperationStore {
  private readonly pool: Pool;
  private readonly encryption: DataEncryption;
  constructor(pool: Pool, encryption: DataEncryption) { this.pool = pool; this.encryption = encryption; }

  async prepare(packet: WalletASigningPacket, now = Date.now()): Promise<string> {
    assertWalletASigningPacket(packet, undefined, now);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<{ encrypted_private_state: Buffer; request_status: string; journal_phase: string }>(`SELECT o.encrypted_private_state,r.status AS request_status,j.journal_phase
        FROM orders o JOIN public_order_requests r ON r.request_id=o.order_id JOIN address_allocation_journal j ON j.order_id=o.order_id
        WHERE o.order_id=$1 AND o.status='AWAITING_PAYMENT' AND o.expires_at>$2 FOR UPDATE OF o,r,j`, [packet.orderId, new Date(now)]);
      const row = selected.rows[0];
      if (!row || row.request_status !== 'PAYMENT_READY' || row.journal_phase !== 'RESERVED') throw new Error('Source packet requires an exact fresh PAYMENT_READY order with a durable allocated receiver');
      const order = this.encryption.decrypt<PaymentOrder>(row.encrypted_private_state, `order:${packet.orderId}:private-state`);
      assertWalletASigningPacket(packet, order, now);
      const operationId = randomUUID(); const encrypted = this.encryption.encrypt(packet, `source-operation:${operationId}:packet`);
      const inserted = await client.query<{ operation_id: string }>(`INSERT INTO source_payment_operation_packets(operation_id,order_id,packet_digest,encrypted_packet,encryption_key_version,state,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'PREPARED',$6,$6) ON CONFLICT(order_id) DO NOTHING RETURNING operation_id`, [operationId, packet.orderId, Buffer.from(packet.packetDigest, 'hex'), encrypted, this.encryption.activeVersion, new Date(now)]);
      if (inserted.rows[0]) { await client.query('COMMIT'); return inserted.rows[0].operation_id; }
      const existing = await client.query<{ operation_id: string; packet_digest: Buffer }>('SELECT operation_id,packet_digest FROM source_payment_operation_packets WHERE order_id=$1', [packet.orderId]);
      if (!existing.rows[0]?.packet_digest.equals(Buffer.from(packet.packetDigest, 'hex'))) throw new Error('Order already has a different source signing packet');
      await client.query('COMMIT'); return existing.rows[0].operation_id;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async load(operationId: string): Promise<SourcePaymentOperation> {
    const result = await this.pool.query<OperationRow>('SELECT * FROM source_payment_operation_packets WHERE operation_id=$1', [operationId]); const row = result.rows[0];
    if (!row) throw new Error('Source payment operation not found');
    const packet = this.encryption.decrypt<WalletASigningPacket>(row.encrypted_packet, `source-operation:${operationId}:packet`);
    assertWalletASigningPacket(packet, undefined, row.created_at.getTime());
    if (!row.packet_digest.equals(Buffer.from(packet.packetDigest, 'hex')) || row.order_id !== packet.orderId) throw new Error('Stored source payment packet binding is inconsistent');
    const opid = row.encrypted_opid ? this.encryption.decrypt<{ value: string }>(row.encrypted_opid, `source-operation:${operationId}:opid`).value : undefined;
    const txid = row.encrypted_txid ? this.encryption.decrypt<{ value: string }>(row.encrypted_txid, `source-operation:${operationId}:txid`).value : undefined;
    return { operationId, orderId: row.order_id, state: row.state, packet, ...(opid ? { opid } : {}), ...(txid ? { txid } : {}),
      ...(row.recovery_reason ? { recoveryReason: row.recovery_reason } : {}), ...(row.submission_started_at ? { submissionStartedAt: row.submission_started_at.toISOString() } : {}),
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }

  async beginSubmission(operationId: string, packetDigest: string, now = Date.now()): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(packetDigest)) throw new Error('Source packet digest is invalid');
    const result = await this.pool.query(`UPDATE source_payment_operation_packets s SET state='SUBMISSION_STARTED',submission_started_at=$3,updated_at=$3
      FROM orders o,public_order_requests r,address_allocation_journal j WHERE s.operation_id=$1 AND s.packet_digest=$2 AND s.state='PREPARED' AND s.order_id=o.order_id
      AND r.request_id=o.order_id AND j.order_id=o.order_id AND j.journal_phase='RESERVED'
      AND o.status='AWAITING_PAYMENT' AND o.expires_at>$3 AND r.status='PAYMENT_READY'`, [operationId, Buffer.from(packetDigest, 'hex'), new Date(now)]);
    if (result.rowCount !== 1) throw new Error('Source payment is not an unexpired one-time prepared submission');
  }

  async recordOpid(operationId: string, opid: string, now = Date.now()): Promise<void> { await this.transitionOpid(operationId, 'SUBMISSION_STARTED', opid, now); }
  async recordRecoveredOpid(operationId: string, opid: string, now = Date.now()): Promise<void> { await this.transitionOpid(operationId, 'SUBMISSION_AMBIGUOUS', opid, now); }
  async markSubmissionAmbiguous(operationId: string, reason: string, now = Date.now()): Promise<void> {
    if (!reason.trim()) throw new Error('Submission ambiguity reason is required');
    const result = await this.pool.query(`UPDATE source_payment_operation_packets SET state='SUBMISSION_AMBIGUOUS',recovery_reason=$2,updated_at=$3 WHERE operation_id=$1 AND state='SUBMISSION_STARTED'`, [operationId, reason.trim(), new Date(now)]);
    if (result.rowCount !== 1) throw new Error('Only a started source submission can be marked ambiguous');
  }
  async requireRecovery(operationId: string, reason: string, now = Date.now()): Promise<void> {
    if (!reason.trim()) throw new Error('Source recovery reason is required');
    const result = await this.pool.query(`UPDATE source_payment_operation_packets SET state='RECOVERY_REQUIRED',recovery_reason=$2,updated_at=$3 WHERE operation_id=$1 AND state IN ('SUBMISSION_STARTED','OPID_RECORDED','SUBMISSION_AMBIGUOUS')`, [operationId, reason.trim(), new Date(now)]);
    if (result.rowCount !== 1) throw new Error('Source operation is not in a recoverable state');
  }
  async recordTxid(operationId: string, txid: string, now = Date.now()): Promise<void> { await this.transitionTxid(operationId, 'OPID_RECORDED', txid, now); }
  async recordRecoveredTxid(operationId: string, txid: string, now = Date.now()): Promise<void> { await this.transitionTxid(operationId, 'RECOVERY_REQUIRED', txid, now); }

  private async transitionOpid(operationId: string, from: 'SUBMISSION_STARTED' | 'SUBMISSION_AMBIGUOUS', opid: string, now: number): Promise<void> {
    if (!/^opid-[A-Za-z0-9-]+$/.test(opid)) throw new Error('zecd operation ID is invalid');
    const fingerprint = createHash('sha256').update(opid).digest(); const encrypted = this.encryption.encrypt({ value: opid }, `source-operation:${operationId}:opid`);
    const result = await this.pool.query(`UPDATE source_payment_operation_packets SET state='OPID_RECORDED',opid_fingerprint=$3,encrypted_opid=$4,recovery_reason=NULL,updated_at=$5 WHERE operation_id=$1 AND state=$2`, [operationId, from, fingerprint, encrypted, new Date(now)]);
    if (result.rowCount !== 1) throw new Error('Source operation cannot record or replace this zecd operation ID');
  }
  private async transitionTxid(operationId: string, from: 'OPID_RECORDED' | 'RECOVERY_REQUIRED', txid: string, now: number): Promise<void> {
    if (!/^[0-9a-f]{64}$/i.test(txid)) throw new Error('Zcash transaction ID is invalid');
    const normalized = txid.toLowerCase(); const fingerprint = createHash('sha256').update(normalized).digest(); const encrypted = this.encryption.encrypt({ value: normalized }, `source-operation:${operationId}:txid`);
    const result = await this.pool.query(`UPDATE source_payment_operation_packets SET state='TXID_RECORDED',txid_fingerprint=$3,encrypted_txid=$4,recovery_reason=NULL,updated_at=$5 WHERE operation_id=$1 AND state=$2`, [operationId, from, fingerprint, encrypted, new Date(now)]);
    if (result.rowCount !== 1) throw new Error('Source operation cannot record or replace this transaction ID');
  }
}
