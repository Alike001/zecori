import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { PaymentOrder } from '../src/lib/order-coordinator.ts';
import { zatoshisToZec } from '../src/lib/order-coordinator.ts';
import { DataEncryption } from './data-encryption.ts';
import type { SourceWalletHealth } from './zcash-source-wallet.ts';

export const WALLET_A_SEND_RPC_METHOD = 'z_sendmany' as const;
export type WalletASigningPacket = Readonly<{
  version: 1; orderId: string; walletName: string; receiver: string; sourceAmountZatoshis: string;
  sourceAmountZec: string; minimumConfirmations: 10; privacyPolicy: 'FullPrivacy'; memo: 'OMITTED';
  feeMode: 'ZIP-317-wallet-computed'; expiresAt: string; rpcMethod: typeof WALLET_A_SEND_RPC_METHOD;
  rpcParams: readonly ['ANY_ORCHARD', readonly [{address:string;amount:number}], 10, null, 'FullPrivacy'];
  packetDigest: string; inputEligibility: 'confirmed-safe-spendable-ironwood-only-no-legacy-orchard';
}>;

function canonical(value:Record<string,unknown>):string{return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));}
export function prepareWalletASigningPacket(order:PaymentOrder,wallet:SourceWalletHealth,now=Date.now(),feeReserveZatoshis=10_000n):WalletASigningPacket{
  if(order.status!=='AWAITING_PAYMENT'||Date.parse(order.expiresAt)<=now)throw new Error('Order is not in an active source-payment window');
  if(order.sourcePool!=='ironwood'||order.sourceMinimumConfirmations!==10)throw new Error('Order does not require the reviewed ten-confirmation Ironwood source');
  if(!wallet.locked||!wallet.synchronized||!wallet.historyComplete||!wallet.walletOwned||wallet.minimumConfirmations!==10)throw new Error('Wallet A is not locked, synchronized, owned, and ten-confirmation ready');
  const source=BigInt(order.sourceAmountZat);const ironwood=BigInt(wallet.poolZatoshis.ironwood??'0');const legacyOrchard=BigInt(wallet.poolZatoshis.orchard??'0');
  if(legacyOrchard!==0n)throw new Error('ANY_ORCHARD is a shielded-family selector; eligible legacy Orchard notes must be zero before this Ironwood-only send');
  if(ironwood<source+feeReserveZatoshis||!wallet.fullPrivacyCompatible)throw new Error('Confirmed Ironwood value is insufficient for the exact payment and fee reserve');
  const amountZec=zatoshisToZec(order.sourceAmountZat);const amountNumber=Number(amountZec);
  if(!Number.isFinite(amountNumber)||amountNumber<=0||source>BigInt(Number.MAX_SAFE_INTEGER)||BigInt(Math.round(amountNumber*100_000_000))!==source)throw new Error('Source amount cannot be represented as an exact zecd JSON amount');
  const visible={version:1 as const,orderId:order.id,walletName:wallet.walletName,receiver:order.sourceReceiver,sourceAmountZatoshis:order.sourceAmountZat,sourceAmountZec:amountZec,minimumConfirmations:10 as const,privacyPolicy:'FullPrivacy' as const,memo:'OMITTED' as const,feeMode:'ZIP-317-wallet-computed' as const,expiresAt:order.expiresAt,rpcMethod:WALLET_A_SEND_RPC_METHOD,rpcParams:['ANY_ORCHARD',[{address:order.sourceReceiver,amount:amountNumber}],10,null,'FullPrivacy'] as const,inputEligibility:'confirmed-safe-spendable-ironwood-only-no-legacy-orchard' as const};
  return {...visible,packetDigest:createHash('sha256').update(canonical(visible)).digest('hex')};
}

export class PostgresSourcePaymentOperationStore{
  private readonly pool:Pool;private readonly encryption:DataEncryption;
  constructor(pool:Pool,encryption:DataEncryption){this.pool=pool;this.encryption=encryption;}
  async prepare(packet:WalletASigningPacket,now=Date.now()):Promise<string>{
    const {packetDigest,...visible}=packet;const expectedDigest=createHash('sha256').update(canonical(visible)).digest('hex');
    if(packetDigest!==expectedDigest)throw new Error('Source signing packet digest does not match its immutable fields');
    const operationId=randomUUID();const encrypted=this.encryption.encrypt(packet,`source-operation:${operationId}:packet`);
    const result=await this.pool.query<{operation_id:string}>(`INSERT INTO source_payment_operation_packets(operation_id,order_id,packet_digest,encrypted_packet,encryption_key_version,state,created_at,updated_at)
      SELECT $1,$2,$3,$4,$5,'PREPARED',$6,$6 FROM orders WHERE order_id=$2 AND status='AWAITING_PAYMENT' ON CONFLICT(order_id) DO NOTHING RETURNING operation_id`,[operationId,packet.orderId,Buffer.from(packet.packetDigest,'hex'),encrypted,this.encryption.activeVersion,new Date(now)]);
    if(result.rows[0])return result.rows[0].operation_id;const existing=await this.pool.query<{operation_id:string;packet_digest:Buffer}>('SELECT operation_id,packet_digest FROM source_payment_operation_packets WHERE order_id=$1',[packet.orderId]);
    if(!existing.rows[0]?.packet_digest.equals(Buffer.from(packet.packetDigest,'hex')))throw new Error('Order already has a different source signing packet');return existing.rows[0].operation_id;
  }
  async recordOpid(operationId:string,opid:string,now=Date.now()):Promise<void>{if(!/^opid-[A-Za-z0-9-]+$/.test(opid))throw new Error('zecd operation ID is invalid');await this.transitionSecret(operationId,'PREPARED','OPID_RECORDED','opid',opid,now);}
  async markSubmissionAmbiguous(operationId:string,now=Date.now()):Promise<void>{const result=await this.pool.query(`UPDATE source_payment_operation_packets SET state='SUBMISSION_AMBIGUOUS',updated_at=$2 WHERE operation_id=$1 AND state='PREPARED'`,[operationId,new Date(now)]);if(result.rowCount!==1)throw new Error('Only a response-lost prepared operation can be marked ambiguous');}
  async requireRecovery(operationId:string,now=Date.now()):Promise<void>{const result=await this.pool.query(`UPDATE source_payment_operation_packets SET state='RECOVERY_REQUIRED',updated_at=$2 WHERE operation_id=$1 AND state IN ('OPID_RECORDED','SUBMISSION_AMBIGUOUS')`,[operationId,new Date(now)]);if(result.rowCount!==1)throw new Error('Source operation is not in a recoverable state');}
  async recordTxid(operationId:string,txid:string,now=Date.now()):Promise<void>{if(!/^[0-9a-f]{64}$/i.test(txid))throw new Error('Zcash transaction ID is invalid');await this.transitionSecret(operationId,'OPID_RECORDED','TXID_RECORDED','txid',txid.toLowerCase(),now);}
  async recordRecoveredTxid(operationId:string,txid:string,now=Date.now()):Promise<void>{if(!/^[0-9a-f]{64}$/i.test(txid))throw new Error('Zcash transaction ID is invalid');await this.transitionSecret(operationId,'RECOVERY_REQUIRED','TXID_RECORDED','txid',txid.toLowerCase(),now);}
  private async transitionSecret(operationId:string,from:string,to:string,kind:'opid'|'txid',value:string,now:number){const fingerprint=createHash('sha256').update(value).digest();const encrypted=this.encryption.encrypt({value},`source-operation:${operationId}:${kind}`);const result=await this.pool.query(`UPDATE source_payment_operation_packets SET state=$3,${kind}_fingerprint=$4,encrypted_${kind}=$5,updated_at=$6 WHERE operation_id=$1 AND state=$2`,[operationId,from,to,fingerprint,encrypted,new Date(now)]);if(result.rowCount!==1)throw new Error('Source operation transition is not allowed or was already recorded');}
}
