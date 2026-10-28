import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  TEST_QUOTE_CHAIN_ID, TEST_QUOTE_TOKEN_CONTRACT, bindingFingerprint,
  calculateApprovedTestQuote, exactEvmRecipient, unsignedAtomic,
  type ApprovedTestRate,
} from './test-variable-quote.ts';

export type PersistentQuoteStatus = 'RESERVED'|'CONSUMED'|'RELEASED'|'RECOVERY_REQUIRED'|'REFUND_PENDING'|'REFUNDED';
export type PersistentTestVariableQuote = Readonly<{
  quoteId: string; orderId: string; approvalId: string; providerId: string;
  destinationRecipient: string; destinationChainId: 84532; destinationTokenContract: string;
  sourceAtomic: string; grossDestinationAtomic: string; feeDestinationAtomic: string;
  destinationAtomic: string; bindingFingerprint: string; createdAt: string; expiresAt: string;
  status: PersistentQuoteStatus;
}>;

type ApprovalRow = {
  approval_id: string; provider_id: string; immutable_terms: ApprovedTestRate;
  terms_fingerprint: Buffer; approved_at: Date; expires_at: Date;
  liquidity_capacity_destination_atomic: string; status: 'APPROVED'|'REVOKED';
};
type QuoteRow = {
  quote_id: string; order_id: string; approval_id: string; binding_fingerprint: Buffer;
  destination_recipient: string; destination_chain_id: 84532; destination_token_contract: string;
  source_atomic: string; gross_destination_atomic: string; fee_destination_atomic: string;
  destination_atomic: string; status: PersistentQuoteStatus; created_at: Date; expires_at: Date;
};

function canonicalRate(rate: ApprovedTestRate): string {
  return JSON.stringify(Object.fromEntries(Object.entries(rate).sort(([a], [b]) => a.localeCompare(b))));
}
function rateFingerprint(rate: ApprovedTestRate): Buffer { return createHash('sha256').update(canonicalRate(rate)).digest(); }
function requireUuid(value: string, label: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error(`${label} must be an exact UUID`);
}
function validateRate(rate: ApprovedTestRate): void {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(rate.providerId) || !rate.approvalId.trim()) throw new Error('Approved provider identity is invalid');
  const approved = Date.parse(rate.approvedAt); const expires = Date.parse(rate.expiresAt);
  if (!Number.isFinite(approved) || !Number.isFinite(expires) || expires <= approved) throw new Error('Provider approval window is invalid');
  const minimum = unsignedAtomic('Minimum source amount', rate.minimumSourceAtomic);
  const maximum = unsignedAtomic('Maximum source amount', rate.maximumSourceAtomic);
  if (maximum < minimum) throw new Error('Maximum source amount is below the minimum');
  unsignedAtomic('Rate numerator', rate.destinationAtomicNumerator);
  unsignedAtomic('Rate denominator', rate.sourceAtomicDenominator);
  unsignedAtomic('Fixed fee', rate.fixedFeeDestinationAtomic, true);
  unsignedAtomic('Minimum destination amount', rate.minimumDestinationAtomic);
  unsignedAtomic('Liquidity capacity', rate.liquidityCapacityDestinationAtomic);
  if (!Number.isSafeInteger(rate.feeBps) || rate.feeBps < 0 || rate.feeBps > 10_000) throw new Error('Fee basis points are invalid');
}

export class PostgresTestVariableQuoteStore {
  private readonly pool: Pool;
  private readonly quoteLifetimeMs: number;
  constructor(pool: Pool, quoteLifetimeMs = 5 * 60_000) {
    if (!Number.isSafeInteger(quoteLifetimeMs) || quoteLifetimeMs < 1_000 || quoteLifetimeMs > 15 * 60_000) throw new Error('Quote lifetime must be between one second and fifteen minutes');
    this.pool=pool; this.quoteLifetimeMs=quoteLifetimeMs;
  }

  async registerApprovedRate(rate: ApprovedTestRate): Promise<void> {
    validateRate(rate); const fingerprint = rateFingerprint(rate);
    const result = await this.pool.query<ApprovalRow>(`INSERT INTO test_variable_rate_approvals
      (approval_id,provider_id,immutable_terms,terms_fingerprint,approved_at,expires_at,liquidity_capacity_destination_atomic,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,'APPROVED') ON CONFLICT (approval_id) DO NOTHING RETURNING *`,
    [rate.approvalId,rate.providerId,rate,fingerprint,new Date(rate.approvedAt),new Date(rate.expiresAt),rate.liquidityCapacityDestinationAtomic]);
    if (result.rowCount === 1) return;
    const existing = await this.pool.query<ApprovalRow>('SELECT * FROM test_variable_rate_approvals WHERE approval_id=$1',[rate.approvalId]);
    if (!existing.rows[0]?.terms_fingerprint.equals(fingerprint)) throw new Error('Approval ID is already bound to different immutable terms');
  }

  async quote(input: { approvalId: string; orderId: string; destinationRecipient: string; sourceAtomic: string; now?: number }): Promise<PersistentTestVariableQuote> {
    requireUuid(input.orderId,'Order ID'); const recipient=exactEvmRecipient(input.destinationRecipient); const now=input.now??Date.now();
    if (!Number.isSafeInteger(now)||now<0) throw new Error('Quote time is invalid');
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN'); const approval=await this.lockApproval(client,input.approvalId);
      await this.releaseExpiredLocked(client,approval.approval_id,now);
      const rate=approval.immutable_terms; const expectedRateFingerprint=rateFingerprint(rate);
      if (!approval.terms_fingerprint.equals(expectedRateFingerprint) || rate.approvalId!==approval.approval_id || rate.providerId!==approval.provider_id) throw new Error('Persisted rate approval binding is invalid');
      if (approval.status!=='APPROVED'||now<Date.parse(rate.approvedAt)) throw new Error('Approved provider rate is not active yet');
      if (now>=approval.expires_at.getTime()) throw new Error('Approved provider rate has expired');
      const source=unsignedAtomic('Source amount',input.sourceAtomic);
      if(source<unsignedAtomic('Minimum source amount',rate.minimumSourceAtomic)||source>unsignedAtomic('Maximum source amount',rate.maximumSourceAtomic)) throw new Error('Source amount is outside the approved test range');
      const expectedBinding=bindingFingerprint(input.orderId,recipient,source.toString(),approval.approval_id);
      const prior=await client.query<QuoteRow>('SELECT * FROM test_variable_quote_reservations WHERE order_id=$1 FOR UPDATE',[input.orderId]);
      if(prior.rows[0]) {
        if(prior.rows[0].binding_fingerprint.toString('hex')!==expectedBinding) throw new Error('Order already has a quote with different immutable terms');
        if(prior.rows[0].status==='RELEASED'||prior.rows[0].status==='REFUNDED') throw new Error('Order quote allocation is terminal and cannot be replaced');
        await client.query('COMMIT'); return this.publicQuote(prior.rows[0],approval.provider_id);
      }
      const amounts=calculateApprovedTestQuote(rate,source.toString());
      const liabilities=await client.query<{reserved:string}>(`SELECT COALESCE(sum(destination_atomic),0)::text AS reserved FROM test_variable_quote_reservations
        WHERE approval_id=$1 AND status IN ('RESERVED','CONSUMED','RECOVERY_REQUIRED','REFUND_PENDING')`,[approval.approval_id]);
      const available=BigInt(approval.liquidity_capacity_destination_atomic)-BigInt(liabilities.rows[0]?.reserved??'0');
      if(amounts.destination>available) throw new Error('Approved test liquidity capacity is unavailable');
      const created=new Date(now); const expires=new Date(Math.min(now+this.quoteLifetimeMs,approval.expires_at.getTime()));
      const quoteId=randomUUID(); const inserted=await client.query<QuoteRow>(`INSERT INTO test_variable_quote_reservations
        (quote_id,order_id,approval_id,binding_fingerprint,destination_recipient,destination_chain_id,destination_token_contract,source_atomic,gross_destination_atomic,fee_destination_atomic,destination_atomic,status,created_at,expires_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RESERVED',$12,$13,$12) RETURNING *`,
      [quoteId,input.orderId,approval.approval_id,Buffer.from(expectedBinding,'hex'),recipient,TEST_QUOTE_CHAIN_ID,TEST_QUOTE_TOKEN_CONTRACT,source.toString(),amounts.gross.toString(),amounts.fee.toString(),amounts.destination.toString(),created,expires]);
      await client.query('COMMIT'); return this.publicQuote(inserted.rows[0],approval.provider_id);
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async consume(input:{quoteId:string;orderId:string;destinationRecipient:string;destinationChainId:number;destinationTokenContract:string;observedSourceAtomic:string;now?:number}):Promise<PersistentTestVariableQuote>{
    requireUuid(input.quoteId,'Quote ID'); requireUuid(input.orderId,'Order ID'); const recipient=exactEvmRecipient(input.destinationRecipient); const now=input.now??Date.now();
    const observedSource=unsignedAtomic('Observed source amount',input.observedSourceAtomic,true);
    const client=await this.pool.connect(); try { await client.query('BEGIN');
      const result=await client.query<QuoteRow&{provider_id:string}>(`SELECT q.*,a.provider_id FROM test_variable_quote_reservations q JOIN test_variable_rate_approvals a USING(approval_id) WHERE q.quote_id=$1 FOR UPDATE OF q`,[input.quoteId]); const quote=result.rows[0];
      if(!quote||quote.order_id!==input.orderId||quote.destination_recipient!==recipient||input.destinationChainId!==TEST_QUOTE_CHAIN_ID||input.destinationTokenContract!==TEST_QUOTE_TOKEN_CONTRACT) throw new Error('Quote does not match the exact order, recipient, chain, and token binding');
      if(quote.status!=='RESERVED'||quote.expires_at.getTime()<=now) throw new Error('Quote reservation is not active');
      if(observedSource!==BigInt(quote.source_atomic)) throw new Error(observedSource<BigInt(quote.source_atomic)?'Source payment is an underpayment':'Source payment is an overpayment');
      const updated=await client.query<QuoteRow>(`UPDATE test_variable_quote_reservations SET status='CONSUMED',consumed_at=$2,updated_at=$2 WHERE quote_id=$1 AND status='RESERVED' RETURNING *`,[input.quoteId,new Date(now)]);
      await client.query('COMMIT'); return this.publicQuote(updated.rows[0],quote.provider_id);
    } catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
  }

  async assessSourcePayment(quoteId:string,observedSourceAtomic:string):Promise<'UNDERPAYMENT'|'EXACT'|'OVERPAYMENT'>{
    requireUuid(quoteId,'Quote ID'); const observed=unsignedAtomic('Observed source amount',observedSourceAtomic,true);
    const result=await this.pool.query<{source_atomic:string}>('SELECT source_atomic::text FROM test_variable_quote_reservations WHERE quote_id=$1',[quoteId]);
    if(!result.rows[0]) throw new Error('Quote not found'); const expected=BigInt(result.rows[0].source_atomic);
    return observed<expected?'UNDERPAYMENT':observed>expected?'OVERPAYMENT':'EXACT';
  }

  async releaseExpired(now=Date.now()):Promise<number>{
    const result=await this.pool.query(`UPDATE test_variable_quote_reservations SET status='RELEASED',released_at=$1,updated_at=$1 WHERE status='RESERVED' AND expires_at <= $1`,[new Date(now)]); return result.rowCount??0;
  }

  private async lockApproval(client:PoolClient,approvalId:string):Promise<ApprovalRow>{const result=await client.query<ApprovalRow>('SELECT * FROM test_variable_rate_approvals WHERE approval_id=$1 FOR UPDATE',[approvalId]);if(!result.rows[0])throw new Error('Independent provider rate approval not found');return result.rows[0];}
  private async releaseExpiredLocked(client:PoolClient,approvalId:string,now:number):Promise<void>{await client.query(`UPDATE test_variable_quote_reservations SET status='RELEASED',released_at=$2,updated_at=$2 WHERE approval_id=$1 AND status='RESERVED' AND expires_at <= $2`,[approvalId,new Date(now)]);}
  private publicQuote(row:QuoteRow,providerId:string):PersistentTestVariableQuote{return {quoteId:row.quote_id,orderId:row.order_id,approvalId:row.approval_id,providerId,destinationRecipient:row.destination_recipient,destinationChainId:row.destination_chain_id,destinationTokenContract:row.destination_token_contract,sourceAtomic:row.source_atomic,grossDestinationAtomic:row.gross_destination_atomic,feeDestinationAtomic:row.fee_destination_atomic,destinationAtomic:row.destination_atomic,bindingFingerprint:row.binding_fingerprint.toString('hex'),createdAt:row.created_at.toISOString(),expiresAt:row.expires_at.toISOString(),status:row.status};}
}
