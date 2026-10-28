import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { BASE_USDC, FIXED_RATE, TRUSTED_PROVIDER_ID } from '../src/lib/order-coordinator.ts';
import type { DataEncryption } from './data-encryption.ts';
import type { FinalReceipt, ShareableReceipt } from '../src/lib/receipt.ts';
import type { WalletReadinessIntent } from './wallet-intent.ts';
import { assertPrivateRequestAllowed, type PrivateRequestWindow } from './private-request-window.ts';
import { createDestinationIntentPayload, destinationIntentContext, destinationRecipientFingerprint, digestDestinationIntent, type DestinationIntentPayload } from './destination-intent.ts';

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
  /** Operator acceptance / quote deadline. */
  expiresAt: string;
  /** Immutable shielded payment deadline, present only after acceptance. */
  paymentDeadline?: string;
  destinationBinding: { status: 'confirmed' | 'bound' | 'expired' | 'revoked' | 'legacy-unverified'; consentConfirmedAt?: string; walletControlVerification: 'unverified' | 'verified-eoa' | 'verified-erc1271'; verifiedAt?: string };
  terms: typeof PUBLIC_ROUTE_TERMS;
  destinationReview?: { recipient: string; network: 'base-sepolia'; chainId: 84532; asset: 'USDC'; contract: typeof BASE_USDC; amountAtomic: '1000000' };
  linkedOrderId?: string;
  paymentInstructions?: { receiver: string; expiresAt: string };
  order?: Record<string, unknown>;
  timeline?: Array<{ type: string; at: string; actor: string; details: Record<string, unknown> }>;
};

export interface PublicOrderRequestStore {
  health(): Promise<void>;
  create(ownerId: string, intent: WalletReadinessIntent, now?: number): Promise<PublicOrderRequest>;
  get(ownerId: string, id: string, now?: number): Promise<PublicOrderRequest | undefined>;
  list(ownerId: string, now?: number): Promise<PublicOrderRequest[]>;
  getShareableReceipt(receiptId: string): Promise<ShareableReceipt | undefined>;
  getPrivateReceipt(ownerId: string, receiptId: string): Promise<FinalReceipt | undefined>;
}

function expire(request: PublicOrderRequest, now: number): PublicOrderRequest {
  if (request.status === 'AWAITING_OPERATOR' && Date.parse(request.expiresAt) <= now) return { ...request, status: 'EXPIRED', destinationBinding: { ...request.destinationBinding, status: request.destinationBinding.status === 'confirmed' ? 'expired' : request.destinationBinding.status } };
  return request;
}

export class MemoryPublicOrderRequestStore implements PublicOrderRequestStore {
  private requests: Array<PublicOrderRequest & { ownerId: string; privateIntent: DestinationIntentPayload }> = [];
  async health(): Promise<void> {}
  async getShareableReceipt(): Promise<undefined> { return undefined; }
  async getPrivateReceipt(): Promise<undefined> { return undefined; }
  async create(ownerId: string, intent: WalletReadinessIntent, now = Date.now()): Promise<PublicOrderRequest> {
    const existing = this.requests.find(item => item.ownerId === ownerId && item.status === 'AWAITING_OPERATOR' && Date.parse(item.expiresAt) > now);
    if (existing) {
      if (existing.privateIntent.destination.address.toLowerCase() !== intent.destination.address.toLowerCase() || existing.privateIntent.source.mode !== intent.source.mode || existing.privateIntent.destination.mode !== intent.destination.mode) {
        throw Object.assign(new Error('An open request already has a different immutable destination intent.'), { statusCode: 409, code: 'OPEN_REQUEST_CONFLICT' });
      }
      return publicClone(existing);
    }
    const id = randomUUID(); const intentId = randomUUID(); const createdAt = new Date(now).toISOString(); const expiresAt = new Date(now + 30 * 60_000).toISOString();
    const privateIntent = createDestinationIntentPayload({ intentId, requestId: id, ownerId, intent, confirmedAt: createdAt, expiresAt });
    const request: PublicOrderRequest & { ownerId: string; privateIntent: DestinationIntentPayload } = {
      id, ownerId, status: 'AWAITING_OPERATOR', createdAt, expiresAt, terms: PUBLIC_ROUTE_TERMS,
      destinationBinding: { status: 'confirmed', consentConfirmedAt: createdAt, walletControlVerification: 'unverified' }, privateIntent,
    };
    this.requests.push(request);
    return publicClone(request);
  }
  async get(ownerId: string, id: string, now = Date.now()): Promise<PublicOrderRequest | undefined> {
    const request = this.requests.find(item => item.ownerId === ownerId && item.id === id);
    return request && publicClone(expire(request, now));
  }
  async list(ownerId: string, now = Date.now()): Promise<PublicOrderRequest[]> {
    return this.requests.filter(item => item.ownerId === ownerId).map(item => publicClone(expire(item, now)));
  }
}

function publicClone(request: PublicOrderRequest & { ownerId?: string; privateIntent?: DestinationIntentPayload }): PublicOrderRequest {
  const { ownerId: _ownerId, privateIntent, ...visible } = request;
  return structuredClone({
    ...visible,
    ...(privateIntent ? { destinationReview: { recipient: privateIntent.destination.address, network: 'base-sepolia' as const, chainId: 84532 as const, asset: 'USDC' as const, contract: BASE_USDC, amountAtomic: '1000000' as const } } : {}),
  });
}

function ownerHash(ownerId: string): Buffer {
  return createHash('sha256').update(ownerId).digest();
}

type RequestRow = {
  request_id: string; status: PublicRequestStatus; created_at: Date; expires_at: Date;
  order_expires_at: Date | null;
  destination_binding_version: number; linked_order_id: string | null;
  encrypted_payment_receiver: Buffer | null; public_view: Record<string, unknown> | null;
  intent_id: string | null; encrypted_intent: Buffer | null; consent_confirmed_at: Date | null; intent_status: 'CONFIRMED' | 'BOUND' | 'EXPIRED' | 'REVOKED' | null;
  proof_method: 'EIP712_EOA' | 'ERC1271' | null; proof_verified_at: Date | null; proof_status: 'VERIFIED' | 'RECHECK_FAILED' | null;
};

function fromRow(row: RequestRow, encryption?: DataEncryption): PublicOrderRequest {
  const instructions = row.encrypted_payment_receiver
    ? encryption?.decrypt<{ receiver: string }>(row.encrypted_payment_receiver, `request:${row.request_id}:receiver`)
    : undefined;
  const intent = row.intent_id && row.encrypted_intent && encryption
    ? encryption.decrypt<DestinationIntentPayload>(row.encrypted_intent, destinationIntentContext(row.intent_id))
    : undefined;
  return {
    id: row.request_id, status: row.status, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
    ...(row.order_expires_at ? { paymentDeadline: row.order_expires_at.toISOString() } : {}),
    terms: PUBLIC_ROUTE_TERMS,
    ...(intent ? { destinationReview: { recipient: intent.destination.address, network: 'base-sepolia' as const, chainId: 84532 as const, asset: 'USDC' as const, contract: BASE_USDC, amountAtomic: '1000000' as const } } : {}),
    destinationBinding: row.destination_binding_version === 2 && row.intent_status
      ? { status: row.intent_status.toLowerCase() as 'confirmed' | 'bound' | 'expired' | 'revoked', ...(row.consent_confirmed_at ? { consentConfirmedAt: row.consent_confirmed_at.toISOString() } : {}), walletControlVerification: row.proof_status === 'VERIFIED' ? (row.proof_method === 'ERC1271' ? 'verified-erc1271' : 'verified-eoa') : 'unverified', ...(row.proof_status === 'VERIFIED' && row.proof_verified_at ? { verifiedAt: row.proof_verified_at.toISOString() } : {}) }
      : { status: 'legacy-unverified', walletControlVerification: 'unverified' },
    ...(row.linked_order_id ? { linkedOrderId: row.linked_order_id } : {}),
    ...(instructions && row.order_expires_at ? { paymentInstructions: { receiver: instructions.receiver, expiresAt: row.order_expires_at.toISOString() } } : {}),
    ...(row.public_view ? { order: row.public_view } : {}),
  };
}

const SELECT_REQUEST = `SELECT r.request_id, r.status, r.created_at, r.expires_at, o.expires_at AS order_expires_at, r.destination_binding_version, r.linked_order_id,
  r.encrypted_payment_receiver, o.public_view, d.intent_id, d.encrypted_intent, d.consent_confirmed_at, d.status AS intent_status,
  p.method AS proof_method,p.verified_at AS proof_verified_at,p.verification_status AS proof_status
  FROM public_order_requests r LEFT JOIN orders o ON o.order_id = r.linked_order_id LEFT JOIN destination_intents d ON d.request_id = r.request_id
  LEFT JOIN destination_wallet_proofs p ON p.intent_id=d.intent_id`;

export class PostgresPublicOrderRequestStore implements PublicOrderRequestStore {
  private readonly pool: Pool;
  private readonly encryption?: DataEncryption;
  private readonly requestWindow?: PrivateRequestWindow;
  constructor(pool: Pool, encryption?: DataEncryption, requestWindow?: PrivateRequestWindow) { this.pool = pool; this.encryption = encryption; this.requestWindow = requestWindow; }
  async health(): Promise<void> {
    const result = await this.pool.query('SELECT version FROM schema_migrations WHERE version = ANY($1::text[])', [['007_owner_destination_binding','008_destination_wallet_control']]);
    if (result.rowCount !== 2) throw new Error('Required destination migrations are missing');
  }

  async create(ownerId: string, intent: WalletReadinessIntent, now = Date.now()): Promise<PublicOrderRequest> {
    if (!this.encryption) throw new Error('Destination intent encryption is unavailable');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (this.requestWindow) {
        // One global allowance across owners, concurrent HTTP calls and restarts.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('zecori-private-one-request', 0))");
        assertPrivateRequestAllowed(this.requestWindow, intent);
        const used = await client.query<{ count: string }>('SELECT count(*) FROM public_order_requests');
        if (used.rows[0].count !== '0') throw Object.assign(new Error('The private single request has already been created. Retrieve it from Activity; do not create another.'), { statusCode: 409, code: 'PRIVATE_REQUEST_WINDOW_CONSUMED' });
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [ownerId]);
      await client.query(`UPDATE public_order_requests SET status = 'EXPIRED', updated_at = $2
        WHERE owner_session_hash = $1 AND status = 'AWAITING_OPERATOR' AND expires_at <= $2`, [ownerHash(ownerId), new Date(now)]);
      await client.query(`UPDATE destination_intents d SET status='EXPIRED' FROM public_order_requests r
        WHERE d.request_id=r.request_id AND r.owner_session_hash=$1 AND d.status='CONFIRMED' AND d.expires_at <= $2`, [ownerHash(ownerId), new Date(now)]);
      const existing = await client.query<RequestRow>(`${SELECT_REQUEST}
        WHERE r.owner_session_hash = $1 AND r.status = 'AWAITING_OPERATOR' AND r.expires_at > $2 ORDER BY r.created_at DESC LIMIT 1 FOR UPDATE OF r`, [ownerHash(ownerId), new Date(now)]);
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (!row.intent_id || !row.encrypted_intent) throw Object.assign(new Error('Open request has no verified destination binding.'), { statusCode: 409, code: 'DESTINATION_BINDING_INCOMPLETE' });
        const saved = this.encryption.decrypt<DestinationIntentPayload>(row.encrypted_intent, destinationIntentContext(row.intent_id));
        if (saved.destination.address.toLowerCase() !== intent.destination.address.toLowerCase() || saved.source.mode !== intent.source.mode || saved.destination.mode !== intent.destination.mode) throw Object.assign(new Error('An open request already has a different immutable destination intent.'), { statusCode: 409, code: 'OPEN_REQUEST_CONFLICT' });
        await client.query('COMMIT'); return fromRow(row, this.encryption);
      }
      const requestId = randomUUID(); const intentId = randomUUID(); const createdAt = new Date(now); const expiresAt = new Date(now + 30 * 60_000);
      const payload = createDestinationIntentPayload({ intentId, requestId, ownerId, intent, confirmedAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString() });
      const encrypted = this.encryption.encrypt(payload, destinationIntentContext(intentId));
      const inserted = await client.query<RequestRow>(`INSERT INTO public_order_requests
        (request_id, owner_session_hash, owner_user_id, destination_binding_version, status, created_at, updated_at, expires_at, legacy_destination_recipient, immutable_terms)
        VALUES ($1, $2, $3, 2, 'AWAITING_OPERATOR', $4, $4, $5, NULL, $6)
        RETURNING request_id,status,created_at,expires_at,NULL::timestamptz AS order_expires_at,destination_binding_version,linked_order_id,encrypted_payment_receiver,NULL::jsonb AS public_view,
          NULL::uuid AS intent_id,NULL::bytea AS encrypted_intent,NULL::timestamptz AS consent_confirmed_at,NULL::text AS intent_status,
          NULL::text AS proof_method,NULL::timestamptz AS proof_verified_at,NULL::text AS proof_status`,
        [requestId, ownerHash(ownerId), ownerId, createdAt, expiresAt, PUBLIC_ROUTE_TERMS]);
      await client.query(`INSERT INTO destination_intents
        (intent_id,request_id,owner_user_id,route_id,network,chain_id,token_contract,amount_atomic,recipient_fingerprint,encrypted_intent,encryption_key_version,consent_version,consent_digest,consent_confirmed_at,wallet_control_verification,status,created_at,expires_at)
        VALUES ($1,$2,$3,$4,'base-sepolia',84532,$5,1000000,$6,$7,$8,$9,$10,$11,'NOT_PERFORMED','CONFIRMED',$11,$12)`,
        [intentId, requestId, ownerId, payload.routeId, BASE_USDC, destinationRecipientFingerprint(payload.destination.address), encrypted, this.encryption.activeVersion, payload.consentVersion, digestDestinationIntent(payload), createdAt, expiresAt]);
      await client.query(`INSERT INTO destination_intent_events(intent_id,actor_type,actor_fingerprint,event_type,occurred_at,details) VALUES ($1,'USER',$2,'INTENT_CONFIRMED',$3,$4)`, [intentId, ownerHash(ownerId), createdAt, { consentVersion: payload.consentVersion, walletControlVerification: 'NOT_PERFORMED' }]);
      await client.query('COMMIT');
      return fromRow({ ...inserted.rows[0], intent_id: intentId, encrypted_intent: encrypted, consent_confirmed_at: createdAt, intent_status: 'CONFIRMED', proof_method: null, proof_verified_at: null, proof_status: null }, this.encryption);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async get(ownerId: string, id: string, now = Date.now()): Promise<PublicOrderRequest | undefined> {
    await this.pool.query(`UPDATE public_order_requests SET status = 'EXPIRED', updated_at = $3
      WHERE request_id = $1 AND owner_session_hash = $2 AND status = 'AWAITING_OPERATOR' AND expires_at <= $3`, [id, ownerHash(ownerId), new Date(now)]);
    await this.pool.query(`UPDATE destination_intents d SET status='EXPIRED' FROM public_order_requests r WHERE d.request_id=r.request_id AND r.request_id=$1 AND r.owner_session_hash=$2 AND d.status='CONFIRMED' AND d.expires_at <= $3`, [id, ownerHash(ownerId), new Date(now)]);
    const result = await this.pool.query<RequestRow>(`${SELECT_REQUEST} WHERE r.request_id = $1 AND r.owner_session_hash = $2`, [id, ownerHash(ownerId)]);
    const value = result.rows[0] && fromRow(result.rows[0], this.encryption);
    if (value?.linkedOrderId) value.timeline = await this.timeline(ownerId, value.linkedOrderId);
    return value;
  }

  async list(ownerId: string, now = Date.now()): Promise<PublicOrderRequest[]> {
    await this.pool.query(`UPDATE public_order_requests SET status = 'EXPIRED', updated_at = $2
      WHERE owner_session_hash = $1 AND status = 'AWAITING_OPERATOR' AND expires_at <= $2`, [ownerHash(ownerId), new Date(now)]);
    await this.pool.query(`UPDATE destination_intents d SET status='EXPIRED' FROM public_order_requests r WHERE d.request_id=r.request_id AND r.owner_session_hash=$1 AND d.status='CONFIRMED' AND d.expires_at <= $2`, [ownerHash(ownerId), new Date(now)]);
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
