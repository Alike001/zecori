import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { encodeFunctionData, getAddress, isAddress, keccak256, parseTransaction, recoverTransactionAddress, serializeTransaction, type Address, type Hex, type TransactionSerialized } from 'viem';
import { BASE_USDC, type PaymentOrder } from '../src/lib/order-coordinator.ts';
import type { OperatorConfig } from './operator-config.ts';

const TRANSFER_ABI=[{type:'function',name:'transfer',stateMutability:'nonpayable',inputs:[{name:'to',type:'address'},{name:'amount',type:'uint256'}],outputs:[{name:'',type:'bool'}]}] as const;
export type BasePayoutSigningPacket=Readonly<{version:1;packetId:string;orderId:string;authorizationId:string;chainId:84532;sender:Address;senderConfirmedAt:string;senderConfirmationSource:'interactive-metamask';tokenContract:typeof BASE_USDC;recipient:Address;amountAtomic:string;nonce:number;gasLimit:string;maxFeePerGas:string;maxPriorityFeePerGas:string;calldata:Hex;value:'0';createdAt:string;expiresAt:string;unsignedSerialized:Hex;packetDigest:string}>;

function uint(label:string,value:string|number):bigint{const text=String(value);if(!/^(0|[1-9]\d*)$/.test(text))throw new Error(`${label} must be an unsigned integer`);return BigInt(text);}
function checksum(label:string,value:string):Address{if(!isAddress(value,{strict:true}))throw new Error(`${label} must be an EIP-55 address`);return getAddress(value);}
function canonical(packet:Omit<BasePayoutSigningPacket,'packetDigest'>):string{return JSON.stringify({...packet,unsignedSerialized:packet.unsignedSerialized.toLowerCase()});}

export function prepareBasePayoutSigningPacket(input:{order:PaymentOrder;operatorConfig:OperatorConfig;authorizationId:string;nonce:number;gasLimit:string;maxFeePerGas:string;maxPriorityFeePerGas:string;now?:number;ttlMs?:number}):BasePayoutSigningPacket{
  const {order}=input;const now=input.now??Date.now();const ttl=input.ttlMs??10*60_000;
  if(order.status!=='PAYOUT_AWAITING_APPROVAL'||order.payoutAuthorization.state!=='APPROVED'||order.payoutAuthorization.authorizationId!==input.authorizationId)throw new Error('Order lacks the exact reviewed payout authorization');
  if(order.destinationChainId!==84532||order.destinationAsset.contract!==BASE_USDC)throw new Error('Order destination is not official Base Sepolia test-USDC');
  const senderConfirmedAt=Date.parse(input.operatorConfig.confirmedAt);
  if(input.operatorConfig.network!=='base-sepolia'||input.operatorConfig.chainId!==84532||input.operatorConfig.confirmationSource!=='interactive-metamask'||!Number.isFinite(senderConfirmedAt)||senderConfirmedAt>now)throw new Error('Confirmed operator LP configuration is invalid');
  if(!Number.isSafeInteger(input.nonce)||input.nonce<0||!Number.isSafeInteger(ttl)||ttl<60_000||ttl>15*60_000)throw new Error('Nonce or signing-packet lifetime is invalid');
  const sender=checksum('LP sender',input.operatorConfig.lpSender),recipient=checksum('Payout recipient',order.destinationRecipient);if(sender===recipient)throw new Error('LP sender cannot substitute for the payout recipient');
  const gas=uint('Gas limit',input.gasLimit),maxFee=uint('Max fee per gas',input.maxFeePerGas),priority=uint('Max priority fee per gas',input.maxPriorityFeePerGas),amount=uint('Payout amount',order.destinationAmountAtomic);
  if(gas===0n||maxFee===0n||priority===0n||priority>maxFee||amount===0n)throw new Error('Payout amount and EIP-1559 fee bounds must be positive and coherent');
  const calldata=encodeFunctionData({abi:TRANSFER_ABI,functionName:'transfer',args:[recipient,amount]});
  const unsignedSerialized=serializeTransaction({type:'eip1559',chainId:84532,nonce:input.nonce,to:BASE_USDC as Address,value:0n,data:calldata,gas,maxFeePerGas:maxFee,maxPriorityFeePerGas:priority});
  const visible={version:1 as const,packetId:randomUUID(),orderId:order.id,authorizationId:input.authorizationId,chainId:84532 as const,sender,senderConfirmedAt:input.operatorConfig.confirmedAt,senderConfirmationSource:input.operatorConfig.confirmationSource,tokenContract:BASE_USDC as typeof BASE_USDC,recipient,amountAtomic:amount.toString(),nonce:input.nonce,gasLimit:gas.toString(),maxFeePerGas:maxFee.toString(),maxPriorityFeePerGas:priority.toString(),calldata,value:'0' as const,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+ttl).toISOString(),unsignedSerialized};
  return {...visible,packetDigest:createHash('sha256').update(canonical(visible)).digest('hex')};
}

export async function verifySignedPayoutTransaction(packet:BasePayoutSigningPacket,signedRaw:TransactionSerialized):Promise<{transactionHash:Hex;rawFingerprint:string}>{
  if(!/^0x[0-9a-f]+$/i.test(signedRaw))throw new Error('Signed transaction encoding is invalid');const tx=parseTransaction(signedRaw);const recovered=getAddress(await recoverTransactionAddress({serializedTransaction:signedRaw}));
  if(recovered!==packet.sender||tx.type!=='eip1559'||tx.chainId!==packet.chainId||tx.nonce!==packet.nonce||getAddress(tx.to!)!==packet.tokenContract||tx.value!==0n||tx.data?.toLowerCase()!==packet.calldata.toLowerCase()||tx.gas!==BigInt(packet.gasLimit)||tx.maxFeePerGas!==BigInt(packet.maxFeePerGas)||tx.maxPriorityFeePerGas!==BigInt(packet.maxPriorityFeePerGas))throw new Error('Signed transaction does not match the immutable payout packet');
  return {transactionHash:keccak256(signedRaw),rawFingerprint:createHash('sha256').update(signedRaw.toLowerCase()).digest('hex')};
}

export class PostgresBasePayoutPacketStore{
  private readonly pool:Pool;constructor(pool:Pool){this.pool=pool;}
  async prepare(packet:BasePayoutSigningPacket):Promise<void>{const {packetDigest,...visible}=packet;if(packetDigest!==createHash('sha256').update(canonical(visible)).digest('hex'))throw new Error('Payout packet digest does not match its immutable fields');const client=await this.pool.connect();try{await client.query('BEGIN');
    const valid=await client.query(`SELECT 1 FROM orders o JOIN authorization_records a ON a.order_id=o.order_id WHERE o.order_id=$1 AND o.status='PAYOUT_AWAITING_APPROVAL' AND a.authorization_id=$2 AND a.kind='PAYOUT' AND a.state='CONSUMED' FOR UPDATE OF o,a`,[packet.orderId,packet.authorizationId]);if(!valid.rows[0])throw new Error('Payout packet has no consumed authorization on the exact order');
    await client.query(`INSERT INTO base_payout_signing_packets(packet_id,order_id,authorization_id,chain_id,sender,sender_confirmed_at,sender_confirmation_source,token_contract,recipient,amount_atomic,nonce,gas_limit,max_fee_per_gas,max_priority_fee_per_gas,calldata,packet_digest,state,created_at,expires_at,updated_at)
      VALUES($1,$2,$3,84532,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'PREPARED',$16,$17,$16)`,[packet.packetId,packet.orderId,packet.authorizationId,packet.sender,new Date(packet.senderConfirmedAt),packet.senderConfirmationSource,packet.tokenContract,packet.recipient,packet.amountAtomic,packet.nonce,packet.gasLimit,packet.maxFeePerGas,packet.maxPriorityFeePerGas,packet.calldata,Buffer.from(packet.packetDigest,'hex'),new Date(packet.createdAt),new Date(packet.expiresAt)]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  async recordSigned(packet:BasePayoutSigningPacket,signedRaw:TransactionSerialized,now=Date.now()){const checked=await verifySignedPayoutTransaction(packet,signedRaw);const result=await this.pool.query(`UPDATE base_payout_signing_packets SET state='SIGNED',signed_transaction_hash=$2,signed_raw_fingerprint=$3,updated_at=$4 WHERE packet_id=$1 AND state='PREPARED' AND expires_at>$4`,[packet.packetId,Buffer.from(checked.transactionHash.slice(2),'hex'),Buffer.from(checked.rawFingerprint,'hex'),new Date(now)]);if(result.rowCount!==1)throw new Error('Payout packet is expired, already signed, or not prepared');return checked.transactionHash;}
  async markSubmitted(packetId:string,transactionHash:Hex,now=Date.now()){const result=await this.pool.query(`UPDATE base_payout_signing_packets SET state='SUBMITTED',updated_at=$3 WHERE packet_id=$1 AND state='SIGNED' AND signed_transaction_hash=$2`,[packetId,Buffer.from(transactionHash.slice(2),'hex'),new Date(now)]);if(result.rowCount!==1)throw new Error('Only the exact signed payout can be marked submitted');}
  async requireRecovery(packetId:string,now=Date.now()){const result=await this.pool.query(`UPDATE base_payout_signing_packets SET state='RECOVERY_REQUIRED',updated_at=$2 WHERE packet_id=$1 AND state IN ('PREPARED','SIGNED','SUBMITTED')`,[packetId,new Date(now)]);if(result.rowCount!==1)throw new Error('Payout packet is not in an ambiguous recoverable state');}
  async reconcileSubmitted(packetId:string,transactionHash:Hex,now=Date.now()){const result=await this.pool.query(`UPDATE base_payout_signing_packets SET state='SUBMITTED',updated_at=$3 WHERE packet_id=$1 AND state='RECOVERY_REQUIRED' AND signed_transaction_hash=$2`,[packetId,Buffer.from(transactionHash.slice(2),'hex'),new Date(now)]);if(result.rowCount!==1)throw new Error('Recovered payout hash does not match the journaled signed transaction');}
  async markConfirmed(packetId:string,transactionHash:Hex,now=Date.now()){const result=await this.pool.query(`UPDATE base_payout_signing_packets SET state='CONFIRMED',updated_at=$3 WHERE packet_id=$1 AND state IN ('SUBMITTED','RECOVERY_REQUIRED') AND signed_transaction_hash=$2`,[packetId,Buffer.from(transactionHash.slice(2),'hex'),new Date(now)]);if(result.rowCount!==1)throw new Error('Only independently verified exact payout evidence can confirm the packet journal');}
}
