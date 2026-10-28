import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { Address, Hex } from 'viem';
import type { DataEncryption } from './data-encryption.ts';
import { assertDestinationPayload, destinationIntentContext, destinationRecipientFingerprint, type DestinationIntentPayload } from './destination-intent.ts';
import {
  BaseSepoliaWalletControlVerifier, challengeContext, destinationControlTypedData, proofContext,
  sessionFingerprint, type DestinationControlTypedData, type WalletControlProof,
} from './wallet-control.ts';
import type { AuthenticatedUser } from './user-auth.ts';

export type DestinationChallenge = { challengeId: string; requestId: string; intentId: string; recipient: Address; expiresAt: string; typedData: DestinationControlTypedData };
export type DestinationVerification = { requestId: string; intentId: string; status: 'verified'; method: 'eip712-eoa' | 'erc1271'; verifiedAt: string };

export interface DestinationWalletControlService {
  health(): Promise<void>;
  issue(session: AuthenticatedUser, requestId: string, origin: string, now?: number): Promise<DestinationChallenge>;
  verify(session: AuthenticatedUser, challengeId: string, signature: unknown, origin: string, now?: number): Promise<DestinationVerification>;
}

function hash(value: string): Buffer { return createHash('sha256').update(value).digest(); }
function signature(value: unknown): Hex {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(value) || value.length > 16_386) throw Object.assign(new Error('Wallet signature encoding is invalid.'), { code: 'INVALID_WALLET_SIGNATURE' });
  return value as Hex;
}

export class UnavailableDestinationWalletControl implements DestinationWalletControlService {
  async health() {}
  async issue(): Promise<never> { throw Object.assign(new Error('Destination wallet verification is unavailable.'), { statusCode: 503, code: 'WALLET_VERIFICATION_UNAVAILABLE' }); }
  async verify(): Promise<never> { throw Object.assign(new Error('Destination wallet verification is unavailable.'), { statusCode: 503, code: 'WALLET_VERIFICATION_UNAVAILABLE' }); }
}

export class PostgresDestinationWalletControl implements DestinationWalletControlService {
  private readonly pool: Pool; private readonly encryption: DataEncryption; private readonly verifier: BaseSepoliaWalletControlVerifier;
  constructor(pool: Pool, encryption: DataEncryption, verifier: BaseSepoliaWalletControlVerifier) { this.pool=pool; this.encryption=encryption; this.verifier=verifier; }
  async health(): Promise<void> {
    const result = await this.pool.query('SELECT 1 FROM schema_migrations WHERE version=$1', ['008_destination_wallet_control']);
    if (result.rowCount !== 1) throw new Error('Destination wallet-control migration is missing');
  }
  async issue(session: AuthenticatedUser, requestId: string, origin: string, now = Date.now()): Promise<DestinationChallenge> {
    const selected = await this.pool.query<{ intent_id: string; encrypted_intent: Buffer; recipient_fingerprint: Buffer; expires_at: Date }>(`SELECT d.intent_id,d.encrypted_intent,d.recipient_fingerprint,d.expires_at
      FROM destination_intents d JOIN public_order_requests r ON r.request_id=d.request_id
      WHERE r.request_id=$1 AND r.owner_user_id=$2 AND r.owner_session_hash=$3 AND r.status='AWAITING_OPERATOR' AND d.status='CONFIRMED'`,
    [requestId, session.userId, hash(session.userId)]);
    const row = selected.rows[0]; if (!row) throw Object.assign(new Error('Eligible destination intent not found for this owner.'), { statusCode: 404, code: 'DESTINATION_INTENT_NOT_FOUND' });
    if (row.expires_at.getTime() <= now) throw Object.assign(new Error('Destination intent has expired.'), { code: 'DESTINATION_INTENT_EXPIRED' });
    const existing = await this.pool.query('SELECT 1 FROM destination_wallet_proofs WHERE intent_id=$1 AND owner_user_id=$2', [row.intent_id, session.userId]);
    if (existing.rowCount) throw Object.assign(new Error('Destination control is already verified.'), { statusCode: 409, code: 'DESTINATION_ALREADY_VERIFIED' });
    const payload = this.encryption.decrypt<DestinationIntentPayload>(row.encrypted_intent, destinationIntentContext(row.intent_id)); assertDestinationPayload(payload);
    if (payload.ownerId !== session.userId || !row.recipient_fingerprint.equals(destinationRecipientFingerprint(payload.destination.address))) throw new Error('Destination intent evidence mismatch');
    const challengeId = randomUUID(); const issuedAt = now; const expiresAt = Math.min(now + 5 * 60_000, row.expires_at.getTime());
    const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
    const typedData = destinationControlTypedData({ ownerId: session.userId, sessionToken: session.sessionToken, intentId: row.intent_id, recipient: payload.destination.address, origin, nonce, issuedAt, expiresAt });
    const encrypted = this.encryption.encrypt(typedData, challengeContext(challengeId));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE destination_wallet_challenges SET status='EXPIRED',consumed_at=$2 WHERE intent_id=$1 AND status='ISSUED'`, [row.intent_id, new Date(now)]);
      await client.query(`INSERT INTO destination_wallet_challenges(challenge_id,intent_id,owner_user_id,session_hash,recipient_fingerprint,nonce_hash,encrypted_challenge,encryption_key_version,issued_at,expires_at,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ISSUED')`, [challengeId,row.intent_id,session.userId,Buffer.from(sessionFingerprint(session.sessionToken).slice(2),'hex'),row.recipient_fingerprint,hash(nonce),encrypted,this.encryption.activeVersion,new Date(issuedAt),new Date(expiresAt)]);
      await client.query(`INSERT INTO destination_wallet_audit_events(intent_id,challenge_id,actor_type,actor_fingerprint,event_type,occurred_at,details) VALUES($1,$2,'USER',$3,'CHALLENGE_ISSUED',$4,$5)`, [row.intent_id,challengeId,hash(session.userId),new Date(now),{ chainId:84532, origin, purpose:'destination-control', expiresAt:new Date(expiresAt).toISOString() }]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return { challengeId, requestId, intentId: row.intent_id, recipient: payload.destination.address as Address, expiresAt: new Date(expiresAt).toISOString(), typedData };
  }
  async verify(session: AuthenticatedUser, challengeId: string, rawSignature: unknown, origin: string, now = Date.now()): Promise<DestinationVerification> {
    const provided = signature(rawSignature); const client = await this.pool.connect();
    let row: { intent_id: string; owner_user_id: string; encrypted_challenge: Buffer; expires_at: Date; request_id: string; encrypted_intent: Buffer; recipient_fingerprint: Buffer };
    try {
      await client.query('BEGIN');
      const claimed = await client.query<typeof row>(`UPDATE destination_wallet_challenges c SET status=CASE WHEN c.expires_at > $4 THEN 'VERIFYING' ELSE 'EXPIRED' END,consumed_at=$4
        FROM destination_intents d WHERE c.challenge_id=$1 AND c.intent_id=d.intent_id AND c.owner_user_id=$2 AND c.session_hash=$3 AND c.status='ISSUED'
        RETURNING c.intent_id,c.owner_user_id,c.encrypted_challenge,c.expires_at,d.request_id,d.encrypted_intent,c.recipient_fingerprint`,
      [challengeId,session.userId,Buffer.from(sessionFingerprint(session.sessionToken).slice(2),'hex'),new Date(now)]);
      row = claimed.rows[0];
      if (!row) throw Object.assign(new Error('Wallet-control challenge is invalid, already used, or belongs to another session.'), { statusCode: 409, code: 'WALLET_CHALLENGE_UNAVAILABLE' });
      await client.query(`INSERT INTO destination_wallet_audit_events(intent_id,challenge_id,actor_type,actor_fingerprint,event_type,occurred_at,details) VALUES($1,$2,'USER',$3,'CHALLENGE_CONSUMED',$4,$5)`, [row.intent_id,challengeId,hash(session.userId),new Date(now),{ singleUse:true }]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    if (row.expires_at.getTime() <= now) throw Object.assign(new Error('Wallet-control challenge has expired.'), { statusCode: 409, code: 'WALLET_CHALLENGE_EXPIRED' });
    const typedData = this.encryption.decrypt<DestinationControlTypedData>(row.encrypted_challenge, challengeContext(challengeId));
    if (typedData.message.owner !== `0x${hash(session.userId).toString('hex')}` || typedData.message.session !== sessionFingerprint(session.sessionToken) || typedData.message.origin !== origin || typedData.message.intentId !== row.intent_id) throw new Error('Wallet-control challenge binding mismatch');
    const intent = this.encryption.decrypt<DestinationIntentPayload>(row.encrypted_intent, destinationIntentContext(row.intent_id)); assertDestinationPayload(intent);
    if (typedData.message.recipient.toLowerCase() !== intent.destination.address.toLowerCase() || !row.recipient_fingerprint.equals(destinationRecipientFingerprint(intent.destination.address))) throw new Error('Wallet-control recipient binding mismatch');
    let proof: WalletControlProof;
    try { proof = await this.verifier.verify(typedData, provided, now); }
    catch (error) {
      await this.pool.query(`UPDATE destination_wallet_challenges SET status='REJECTED' WHERE challenge_id=$1 AND status='VERIFYING'`, [challengeId]);
      await this.pool.query(`INSERT INTO destination_wallet_audit_events(intent_id,challenge_id,actor_type,event_type,occurred_at,details) VALUES($1,$2,'VERIFIER','PROOF_REJECTED',$3,$4)`, [row.intent_id,challengeId,new Date(now),{ reasonCode:(error as {code?:string}).code ?? 'INVALID_PROOF' }]);
      throw error;
    }
    const proofId = randomUUID();
    const encryptedProof = this.encryption.encrypt(proof.method === 'ERC1271' ? proof : { method:proof.method,digest:proof.digest,verifiedAt:proof.verifiedAt,blockNumber:proof.blockNumber,blockHash:proof.blockHash }, proofContext(challengeId));
    const saved = await this.pool.connect();
    try {
      await saved.query('BEGIN');
      await saved.query(`INSERT INTO destination_wallet_proofs(proof_id,challenge_id,intent_id,owner_user_id,recipient_fingerprint,method,signature_fingerprint,typed_data_digest,encrypted_proof,encryption_key_version,verification_status,verified_at,verified_block_number,verified_block_hash,last_checked_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'VERIFIED',$11,$12,$13,$11)`, [proofId,challengeId,row.intent_id,session.userId,row.recipient_fingerprint,proof.method,hash(provided.toLowerCase()),Buffer.from(proof.digest.slice(2),'hex'),encryptedProof,this.encryption.activeVersion,new Date(proof.verifiedAt),proof.blockNumber,Buffer.from(proof.blockHash.slice(2),'hex')]);
      await saved.query(`UPDATE destination_wallet_challenges SET status='VERIFIED' WHERE challenge_id=$1 AND status='VERIFYING'`, [challengeId]);
      await saved.query(`INSERT INTO destination_wallet_audit_events(intent_id,challenge_id,actor_type,event_type,occurred_at,details) VALUES($1,$2,'VERIFIER','PROOF_VERIFIED',$3,$4)`, [row.intent_id,challengeId,new Date(proof.verifiedAt),{ method:proof.method,chainId:84532,blockNumber:proof.blockNumber }]);
      await saved.query('COMMIT');
    } catch (error) { await saved.query('ROLLBACK'); throw error; } finally { saved.release(); }
    return { requestId: row.request_id, intentId: row.intent_id, status:'verified', method: proof.method === 'ERC1271' ? 'erc1271' : 'eip712-eoa', verifiedAt: proof.verifiedAt };
  }
}
