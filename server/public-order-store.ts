import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { BASE_USDC, FIXED_RATE, TRUSTED_PROVIDER_ID, isFullEvmAddress } from '../src/lib/order-coordinator.ts';
import type { DataEncryption } from './data-encryption.ts';
import type { FinalReceipt, ShareableReceipt } from '../src/lib/receipt.ts';

export const PUBLIC_ROUTE_TERMS = Object.freeze({
  source: { network: 'zcash-testnet', asset: 'TAZ', pool: 'ironwood', amountZatoshis: '1000000', amount: '0.01', confirmations: 10 },
  destination: { network: 'base-sepolia', chainId: 84532, asset: 'USDC', contract: BASE_USDC, amountAtomic: '1000000', amount: '1', confirmations: 3 },
  provider: { id: TRUSTED_PROVIDER_ID, model: 'trusted-liquidity-provider' },
  rate: FIXED_RATE,
  custody: 'The trusted testnet liquidity provider temporarily controls received TAZ. A payout requires separate operator approval and independent Base verification.',
  refunds: 'Late or disputed payments require manual review. Refunds are not automatic and may be unavailable if source evidence cannot be reconciled.',
});

export type PublicRequestStatus = 'AWAITING_OPERATOR' | 'ACCEPTED' | 'PAYMENT_READY' | 'SOURCE_DETECTED' | 'SOURCE_CONFIRMED' | 'PAYOUT_AWAITING_APPROVAL' | 'PAYOUT_SUBMITTED' | 'COMPLETED' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED' | 'UNRESOLVED' | 'EXPIRED' | 'CANCELLED';

export type PublicOrderRequest = {
  id: string;
  status: PublicRequestStatus;
  createdAt: string;
  expiresAt: string;
  destinationRecipient: string;
  terms: typeof PUBLIC_ROUTE_TERMS;
  linkedOrderId?: string;
  paymentInstructions?: { receiver: string; expiresAt: string };
  order?: Record<string, unknown>;
  timeline?: Array<{ type: string; at: string; actor: string; details: Record<string, unknown> }>;
};

export interface PublicOrderRequestStore {
  health(): Promise<void>;
  create(ownerId: string, destinationRecipient: string, now?: number): Promise<PublicOrderRequest>;
  get(ownerId: string, id: string, now?: number): Promise<PublicOrderRequest | undefined>;
  list(ownerId: string, now?: number): Promise<PublicOrderRequest[]>;
  getShareableReceipt(receiptId: string): Promise<ShareableReceipt | undefined>;
  getPrivateReceipt(ownerId: string, receiptId: string): Promise<FinalReceipt | undefined>;
}

function validateRecipient(value: string): string {
  if (!isFullEvmAddress(value)) throw new Error('Configured destination recipient is not a complete Base address');
  if (/^0x0{40}$/i.test(value)) throw new Error('Configured destination recipient must not be the zero address');
  return value;
}

function expire(request: PublicOrderRequest, now: number): PublicOrderRequest {
  if (request.status === 'AWAITING_OPERATOR' && Date.parse(request.expiresAt) <= now) return { ...request, status: 'EXPIRED' };
  return request;
}

export class MemoryPublicOrderRequestStore implements PublicOrderRequestStore {
  private requests: Array<PublicOrderRequest & { ownerId: string }> = [];
  async health(): Promise<void> {}
  async getShareableReceipt(): Promise<undefined> { return undefined; }
  async getPrivateReceipt(): Promise<undefined> { return undefined; }
  async create(ownerId: string, destinationRecipient: string, now = Date.now()): Promise<PublicOrderRequest> {
    const existing = this.requests.find(item => item.ownerId === ownerId && item.status === 'AWAITING_OPERATOR' && Date.parse(item.expiresAt) > now);
    if (existing) return structuredClone(existing);
    const request: PublicOrderRequest & { ownerId: string } = {
      id: randomUUID(), ownerId, status: 'AWAITING_OPERATOR', createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 30 * 60_000).toISOString(), destinationRecipient: validateRecipient(destinationRecipient), terms: PUBLIC_ROUTE_TERMS,
    };
    this.requests.push(request);
    return structuredClone(request);
  }
  async get(ownerId: string, id: string, now = Date.now()): Promise<PublicOrderRequest | undefined> {
    const request = this.requests.find(item => item.ownerId === ownerId && item.id === id);
    return request && structuredClone(expire(request, now));
  }
  async list(ownerId: string, now = Date.now()): Promise<PublicOrderRequest[]> {
    return this.requests.filter(item => item.ownerId === ownerId).map(item => structuredClone(expire(item, now)));
  }
}

function ownerHash(ownerId: string): Buffer {
  return createHash('sha256').update(ownerId).digest();
}

type RequestRow = {
  request_id: string; status: PublicRequestStatus; created_at: Date; expires_at: Date;
  destination_recipient: string; linked_order_id: string | null;
  encrypted_payment_receiver: Buffer | null; public_view: Record<string, unknown> | null;
};

function fromRow(row: RequestRow, encryption?: DataEncryption): PublicOrderRequest {
  const instructions = row.encrypted_payment_receiver
    ? encryption?.decrypt<{ receiver: string }>(row.encrypted_payment_receiver, `request:${row.request_id}:receiver`)
    : undefined;
  return {
    id: row.request_id, status: row.status, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
    destinationRecipient: row.destination_recipient, terms: PUBLIC_ROUTE_TERMS,
    ...(row.linked_order_id ? { linkedOrderId: row.linked_order_id } : {}),
    ...(instructions ? { paymentInstructions: { receiver: instructions.receiver, expiresAt: row.expires_at.toISOString() } } : {}),
    ...(row.public_view ? { order: row.public_view } : {}),
  };
}

const SELECT_REQUEST = `SELECT r.request_id, r.status, r.created_at, r.expires_at, r.destination_recipient, r.linked_order_id,
  r.encrypted_payment_receiver, o.public_view
  FROM public_order_requests r LEFT JOIN orders o ON o.order_id = r.linked_order_id`;

export class PostgresPublicOrderRequestStore implements PublicOrderRequestStore {
  private readonly pool: Pool;
  private readonly encryption?: DataEncryption;
  constructor(pool: Pool, encryption?: DataEncryption) { this.pool = pool; this.encryption = encryption; }
  async health(): Promise<void> {
    const result = await this.pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', ['001_production_foundation']);
    if (result.rowCount !== 1) throw new Error('Required database migration is missing');
  }

  async create(ownerId: string, destinationRecipient: string, now = Date.now()): Promise<PublicOrderRequest> {
    const recipient = validateRecipient(destinationRecipient);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [ownerId]);
      await client.query(`UPDATE public_order_requests SET status = 'EXPIRED', updated_at = $2
        WHERE owner_session_hash = $1 AND status = 'AWAITING_OPERATOR' AND expires_at <= $2`, [ownerHash(ownerId), new Date(now)]);
      const existing = await client.query<RequestRow>(`${SELECT_REQUEST}
        WHERE r.owner_session_hash = $1 AND r.status = 'AWAITING_OPERATOR' AND r.expires_at > $2 ORDER BY r.created_at DESC LIMIT 1 FOR UPDATE OF r`, [ownerHash(ownerId), new Date(now)]);
      if (existing.rows[0]) { await client.query('COMMIT'); return fromRow(existing.rows[0], this.encryption); }
      const inserted = await client.query<RequestRow>(`INSERT INTO public_order_requests
        (request_id, owner_session_hash, status, created_at, updated_at, expires_at, destination_recipient, immutable_terms)
        VALUES ($1, $2, 'AWAITING_OPERATOR', $3, $3, $4, $5, $6) RETURNING request_id, status, created_at, expires_at, destination_recipient, linked_order_id, encrypted_payment_receiver, NULL::jsonb AS public_view`,
        [randomUUID(), ownerHash(ownerId), new Date(now), new Date(now + 30 * 60_000), recipient, PUBLIC_ROUTE_TERMS]);
      await client.query('COMMIT');
      return fromRow(inserted.rows[0], this.encryption);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async get(ownerId: string, id: string, now = Date.now()): Promise<PublicOrderRequest | undefined> {
    await this.pool.query(`UPDATE public_order_requests SET status = 'EXPIRED', updated_at = $3
      WHERE request_id = $1 AND owner_session_hash = $2 AND status = 'AWAITING_OPERATOR' AND expires_at <= $3`, [id, ownerHash(ownerId), new Date(now)]);
    const result = await this.pool.query<RequestRow>(`${SELECT_REQUEST} WHERE r.request_id = $1 AND r.owner_session_hash = $2`, [id, ownerHash(ownerId)]);
    const value = result.rows[0] && fromRow(result.rows[0], this.encryption);
    if (value?.linkedOrderId) value.timeline = await this.timeline(ownerId, value.linkedOrderId);
    return value;
  }

  async list(ownerId: string, now = Date.now()): Promise<PublicOrderRequest[]> {
    await this.pool.query(`UPDATE public_order_requests SET status = 'EXPIRED', updated_at = $2
      WHERE owner_session_hash = $1 AND status = 'AWAITING_OPERATOR' AND expires_at <= $2`, [ownerHash(ownerId), new Date(now)]);
    const result = await this.pool.query<RequestRow>(`${SELECT_REQUEST} WHERE r.owner_session_hash = $1 ORDER BY r.created_at DESC LIMIT 50`, [ownerHash(ownerId)]);
    const values = result.rows.map(row => fromRow(row, this.encryption));
    for (const value of values) if (value.linkedOrderId) value.timeline = await this.timeline(ownerId, value.linkedOrderId);
    return values;
  }

  private async timeline(ownerId: string, orderId: string): Promise<NonNullable<PublicOrderRequest['timeline']>> {
    const result = await this.pool.query<{ event_type: string; occurred_at: Date; actor_type: string; details: Record<string, unknown> }>(`SELECT a.event_type,a.occurred_at,a.actor_type,a.details FROM audit_events a JOIN orders o ON o.order_id=a.order_id WHERE a.order_id=$1 AND o.owner_session_hash=$2 ORDER BY a.event_id`, [orderId, ownerHash(ownerId)]);
    return result.rows.map(row => ({ type: row.event_type, at: row.occurred_at.toISOString(), actor: row.actor_type, details: row.details }));
  }

  async getShareableReceipt(receiptId: string): Promise<ShareableReceipt | undefined> {
    const result = await this.pool.query<{ public_receipt: ShareableReceipt }>('SELECT public_receipt FROM receipts WHERE receipt_id=$1', [receiptId]);
    return result.rows[0]?.public_receipt;
  }

  async getPrivateReceipt(ownerId: string, receiptId: string): Promise<FinalReceipt | undefined> {
    if (!this.encryption) throw new Error('Private receipt decryption is unavailable');
    const result = await this.pool.query<{ encrypted_private_receipt: Buffer }>(`SELECT r.encrypted_private_receipt FROM receipts r JOIN orders o ON o.order_id=r.order_id WHERE r.receipt_id=$1 AND o.owner_session_hash=$2`, [receiptId, ownerHash(ownerId)]);
    const row = result.rows[0];
    return row && this.encryption.decrypt<FinalReceipt>(row.encrypted_private_receipt, `receipt:${receiptId}:private`);
  }
}
