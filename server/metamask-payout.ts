import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getAddress, type Hex } from 'viem';
import { BASE_USDC } from '../src/lib/order-coordinator.ts';
import { assertBasePayoutPacket, assertBasePayoutPacketIntegrity, BASE_PAYOUT_MAX_FEE_PER_GAS, BASE_PAYOUT_MAX_GAS_LIMIT, BASE_PAYOUT_MAX_PRIORITY_FEE_PER_GAS, type BasePayoutSigningPacket } from './base-payout-signing-packet.ts';

export const REAL_METAMASK_BROADCAST_ENABLED=false as const;
export type MetaMaskRequest={method:string;params?:readonly unknown[]};
export type MetaMaskProvider={request(input:MetaMaskRequest):Promise<unknown>};
export type MetaMaskTransaction={from:Hex;to:Hex;value:'0x0';data:Hex;nonce:Hex;gas:Hex;maxFeePerGas:Hex;maxPriorityFeePerGas:Hex};
export type MetaMaskPayoutRehearsal=Readonly<{version:1;packetId:string;packetDigest:string;checkedAt:string;transaction:MetaMaskTransaction;requestDigest:string;observed:{chainId:84532;account:Hex;latestNonce:number;pendingNonce:number;baseFeePerGas:string;gasEstimate:string;ethBalance:string;usdcBalance:string}}>;
export type MetaMaskPayoutSubmissionStore=Pick<PostgresMetaMaskPayoutStore,'beginSubmission'|'recordTransactionHash'|'recordRejection'|'requireRecovery'>;

function quantity(value:unknown,label:string):bigint{if(typeof value!=='string'||!/^0x[0-9a-f]+$/i.test(value))throw new Error(`${label} is not a valid RPC quantity`);return BigInt(value);}
function hex(value:bigint|number):Hex{return `0x${BigInt(value).toString(16)}` as Hex;}
function transaction(packet:BasePayoutSigningPacket):MetaMaskTransaction{return {from:packet.sender,to:packet.tokenContract as Hex,value:'0x0',data:packet.calldata,nonce:hex(packet.nonce),gas:hex(BigInt(packet.gasLimit)),maxFeePerGas:hex(BigInt(packet.maxFeePerGas)),maxPriorityFeePerGas:hex(BigInt(packet.maxPriorityFeePerGas))};}
function digest(value:unknown):string{return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function transactionHash(value:unknown):Hex{if(typeof value!=='string'||!/^0x[0-9a-f]{64}$/i.test(value))throw new Error('MetaMask did not return a transaction hash');return value as Hex;}
function errorCode(error:unknown):number|undefined{if(typeof error!=='object'||error===null)return undefined;const value='code' in error?(error as {code?:unknown}).code:'rpcCode' in error?(error as {rpcCode?:unknown}).rpcCode:undefined;return typeof value==='number'?value:undefined;}

export function createMetaMaskPayoutRequest(rehearsal:MetaMaskPayoutRehearsal):Readonly<{method:'eth_sendTransaction';params:readonly [MetaMaskTransaction];broadcasts:true;returns:'transaction-hash'}>{return {method:'eth_sendTransaction',params:[rehearsal.transaction],broadcasts:true,returns:'transaction-hash'};}
export function classifyMetaMaskSubmissionError(error:unknown):'REJECTED'|'RECOVERY_REQUIRED'{return errorCode(error)===4001?'REJECTED':'RECOVERY_REQUIRED';}
export function expectedMetaMaskPayoutConfirmation(packet:BasePayoutSigningPacket):string{return `BROADCAST BASE-84532 ${packet.packetId} ORDER ${packet.orderId} ${packet.amountAtomic} ${packet.tokenContract} TO ${packet.recipient} FROM ${packet.sender} NONCE ${packet.nonce}`;}
export function expectedMetaMaskRecoveryConfirmation(packet:BasePayoutSigningPacket,hash:Hex):string{return `RECOVER BASE-84532 ${packet.packetId} ${hash.toLowerCase()} NO-RETRY`;}

export async function rehearseMetaMaskPayout(packet:BasePayoutSigningPacket,provider:MetaMaskProvider,now=Date.now()):Promise<MetaMaskPayoutRehearsal>{
  assertBasePayoutPacket(packet,now);
  if(packet.chainId!==84532||packet.tokenContract.toLowerCase()!==BASE_USDC.toLowerCase()||packet.value!=='0')throw new Error('Payout packet is not the exact Base Sepolia test-USDC transfer');
  const [chainValue,accountsValue]=await Promise.all([provider.request({method:'eth_chainId'}),provider.request({method:'eth_accounts'})]);
  if(quantity(chainValue,'MetaMask chain ID')!==84532n)throw new Error('MetaMask is not on Base Sepolia chain 84532');
  if(!Array.isArray(accountsValue)||typeof accountsValue[0]!=='string'||getAddress(accountsValue[0])!==packet.sender)throw new Error('MetaMask selected account is not the exact LP sender');
  const [latestValue,pendingValue,blockValue,estimateValue]=await Promise.all([
    provider.request({method:'eth_getTransactionCount',params:[packet.sender,'latest']}),provider.request({method:'eth_getTransactionCount',params:[packet.sender,'pending']}),
    provider.request({method:'eth_getBlockByNumber',params:['latest',false]}),provider.request({method:'eth_estimateGas',params:[transaction(packet),'pending']}),
  ]);
  const latest=quantity(latestValue,'latest nonce'),pending=quantity(pendingValue,'pending nonce'),estimate=quantity(estimateValue,'gas estimate');
  if(latest>BigInt(Number.MAX_SAFE_INTEGER)||pending>BigInt(Number.MAX_SAFE_INTEGER)||latest>pending||pending!==BigInt(packet.nonce))throw new Error('LP sender nonce conflicts with the approved payout packet');
  const baseFee=quantity((blockValue as {baseFeePerGas?:unknown}|null)?.baseFeePerGas,'latest base fee');const gas=BigInt(packet.gasLimit),maxFee=BigInt(packet.maxFeePerGas),priority=BigInt(packet.maxPriorityFeePerGas);
  if(gas>BASE_PAYOUT_MAX_GAS_LIMIT||estimate>gas||maxFee>BASE_PAYOUT_MAX_FEE_PER_GAS||priority>BASE_PAYOUT_MAX_PRIORITY_FEE_PER_GAS||priority>maxFee||baseFee+priority>maxFee)throw new Error('Payout gas or EIP-1559 fee constraints are unsafe for the current chain state');
  const balanceData=`0x70a08231${packet.sender.slice(2).toLowerCase().padStart(64,'0')}` as Hex;
  const [nativeValue,tokenValue]=await Promise.all([
    provider.request({method:'eth_getBalance',params:[packet.sender,'pending']}),
    provider.request({method:'eth_call',params:[{to:packet.tokenContract,data:balanceData},'pending']}),
  ]);
  if(quantity(nativeValue,'LP ETH balance')<gas*maxFee)throw new Error('LP ETH gas balance is insufficient for the immutable maximum payout fee');
  if(quantity(tokenValue,'LP USDC balance')<BigInt(packet.amountAtomic))throw new Error('LP test-USDC balance is insufficient for the exact payout amount');
  const tx=transaction(packet);return {version:1,packetId:packet.packetId,packetDigest:packet.packetDigest,checkedAt:new Date(now).toISOString(),transaction:tx,requestDigest:digest(tx),observed:{chainId:84532,account:packet.sender,latestNonce:Number(latest),pendingNonce:Number(pending),baseFeePerGas:baseFee.toString(),gasEstimate:estimate.toString(),ethBalance:quantity(nativeValue,'LP ETH balance').toString(),usdcBalance:quantity(tokenValue,'LP USDC balance').toString()}};
}

export async function reconcileMetaMaskNonce(packet:BasePayoutSigningPacket,provider:MetaMaskProvider):Promise<'UNOBSERVED'|'PENDING_OR_CONSUMED'|'CONSUMED'>{const [latestValue,pendingValue]=await Promise.all([provider.request({method:'eth_getTransactionCount',params:[packet.sender,'latest']}),provider.request({method:'eth_getTransactionCount',params:[packet.sender,'pending']})]);const latest=quantity(latestValue,'latest nonce'),pending=quantity(pendingValue,'pending nonce');if(latest>pending)throw new Error('LP sender RPC nonce observations are inconsistent');if(latest>BigInt(packet.nonce))return 'CONSUMED';if(pending>BigInt(packet.nonce))return 'PENDING_OR_CONSUMED';return 'UNOBSERVED';}

export async function submitMetaMaskPayout(input:{packet:BasePayoutSigningPacket;rehearsal:MetaMaskPayoutRehearsal;provider:MetaMaskProvider;store:MetaMaskPayoutSubmissionStore;confirmation:string;broadcastEnabled:true;now?:number}):Promise<Hex>{
  const now=input.now??Date.now();assertBasePayoutPacket(input.packet,now);
  if(input.broadcastEnabled!==true)throw new Error('Real MetaMask broadcast is not explicitly enabled for this operator action');
  if(input.confirmation!==expectedMetaMaskPayoutConfirmation(input.packet))throw new Error('Exact Base payout broadcast confirmation does not match the immutable packet');
  if(input.rehearsal.packetId!==input.packet.packetId||input.rehearsal.packetDigest!==input.packet.packetDigest||digest(input.rehearsal.transaction)!==input.rehearsal.requestDigest)throw new Error('Stored MetaMask rehearsal does not match the immutable payout packet');
  const fresh=await rehearseMetaMaskPayout(input.packet,input.provider,now);
  if(fresh.requestDigest!==input.rehearsal.requestDigest)throw new Error('Fresh MetaMask request differs from the durably rehearsed request');
  await input.store.beginSubmission(input.packet.packetId,input.rehearsal.requestDigest,now);
  try{
    const result=await input.provider.request({method:'eth_sendTransaction',params:[fresh.transaction]});
    const hash=transactionHash(result);await input.store.recordTransactionHash(input.packet.packetId,hash,now);return hash;
  }catch(error){
    if(classifyMetaMaskSubmissionError(error)==='REJECTED'){await input.store.recordRejection(input.packet.packetId,4001,now);throw new Error('MetaMask payout was explicitly rejected by the operator');}
    await input.store.requireRecovery(input.packet.packetId,`ambiguous-metamask-submission${errorCode(error)===undefined?'':`-code-${errorCode(error)}`}`,now).catch(()=>undefined);
    throw new Error('MetaMask payout result is ambiguous; preserve the journal and recover the exact transaction without another prompt');
  }
}

export async function recoverMetaMaskPayoutHash(input:{packet:BasePayoutSigningPacket;provider:MetaMaskProvider;store:Pick<PostgresMetaMaskPayoutStore,'recordTransactionHash'>;transactionHash:Hex;confirmation:string;now?:number}):Promise<Hex>{
  const now=input.now??Date.now(),hash=transactionHash(input.transactionHash);assertBasePayoutPacketIntegrity(input.packet);
  if(input.confirmation!==expectedMetaMaskRecoveryConfirmation(input.packet,hash))throw new Error('Exact Base payout recovery confirmation is required');
  const value=await input.provider.request({method:'eth_getTransactionByHash',params:[hash]});
  if(typeof value!=='object'||value===null)throw new Error('Recovered Base transaction is not observable; automatic retry is forbidden');
  const tx=value as Record<string,unknown>;const actualHash=transactionHash(tx.hash);
  const actualData=typeof tx.input==='string'?tx.input:tx.data;
  if(actualHash.toLowerCase()!==hash.toLowerCase()||typeof tx.from!=='string'||getAddress(tx.from)!==input.packet.sender||typeof tx.to!=='string'||getAddress(tx.to)!==input.packet.tokenContract
    ||quantity(tx.chainId,'recovered chain ID')!==84532n||quantity(tx.nonce,'recovered nonce')!==BigInt(input.packet.nonce)||quantity(tx.value,'recovered value')!==0n
    ||typeof actualData!=='string'||actualData.toLowerCase()!==input.packet.calldata.toLowerCase()||quantity(tx.gas,'recovered gas')!==BigInt(input.packet.gasLimit)
    ||quantity(tx.maxFeePerGas,'recovered max fee')!==BigInt(input.packet.maxFeePerGas)||quantity(tx.maxPriorityFeePerGas,'recovered priority fee')!==BigInt(input.packet.maxPriorityFeePerGas))throw new Error('Recovered Base transaction does not match the immutable payout packet');
  await input.store.recordTransactionHash(input.packet.packetId,hash,now);return hash;
}

export class PostgresMetaMaskPayoutStore{
  private readonly pool:Pool;
  private readonly validateSubmission?: (client:PoolClient,packetId:string,now:number)=>Promise<void>;
  constructor(pool:Pool, validateSubmission?: (client:PoolClient,packetId:string,now:number)=>Promise<void>){this.pool=pool;this.validateSubmission=validateSubmission;}
  async recordRehearsal(rehearsal:MetaMaskPayoutRehearsal,now=Date.now()):Promise<void>{if(!/^[0-9a-f]{64}$/.test(rehearsal.requestDigest)||digest(rehearsal.transaction)!==rehearsal.requestDigest||!/^[0-9a-f]{64}$/.test(rehearsal.packetDigest))throw new Error('MetaMask rehearsal digest is invalid');const result=await this.pool.query(`INSERT INTO base_metamask_payout_submissions(packet_id,request_digest,state,rehearsed_at,updated_at) SELECT packet_id,$2,'REHEARSED',$3,$3 FROM base_payout_signing_packets WHERE packet_id=$1 AND packet_digest=$4 AND state='PREPARED' AND expires_at>$3`,[rehearsal.packetId,Buffer.from(rehearsal.requestDigest,'hex'),new Date(now),Buffer.from(rehearsal.packetDigest,'hex')]);if(result.rowCount!==1)throw new Error('Payout packet is expired, missing, already rehearsed, or not prepared');}
  async beginSubmission(packetId:string,requestDigest:string,now=Date.now()):Promise<void>{if(!/^[0-9a-f]{64}$/.test(requestDigest))throw new Error('MetaMask request digest is invalid');const client=await this.pool.connect();try{await client.query('BEGIN');
    // Lock the order and consumed authorization before changing either journal.
    const valid=await client.query(`SELECT o.order_id FROM orders o JOIN base_payout_signing_packets p ON p.order_id=o.order_id JOIN authorization_records a ON a.authorization_id=p.authorization_id AND a.order_id=o.order_id WHERE p.packet_id=$1 AND o.status='PAYOUT_AWAITING_APPROVAL' AND a.kind='PAYOUT' AND a.state='CONSUMED' AND a.consumed_at IS NOT NULL AND a.consumed_at<=a.expires_at AND a.expires_at>$2 FOR UPDATE OF o,a`,[packetId,new Date(now)]);
    if(valid.rowCount!==1)throw new Error('Payout order or consumed authorization is no longer usable for a one-time submission');
    if(this.validateSubmission)await this.validateSubmission(client,packetId,now);
    const changed=await client.query(`UPDATE base_metamask_payout_submissions s SET state='SUBMISSION_STARTED',submission_started_at=$3,updated_at=$3 FROM base_payout_signing_packets p WHERE s.packet_id=$1 AND s.packet_id=p.packet_id AND s.state='REHEARSED' AND s.request_digest=$2 AND p.state='PREPARED' AND p.expires_at>$3`,[packetId,Buffer.from(requestDigest,'hex'),new Date(now)]);if(changed.rowCount!==1)throw new Error('MetaMask payout is not an unexpired one-time rehearsed submission');const parent=await client.query(`UPDATE base_payout_signing_packets SET state='RECOVERY_REQUIRED',submission_method='METAMASK',updated_at=$2 WHERE packet_id=$1 AND state='PREPARED'`,[packetId,new Date(now)]);if(parent.rowCount!==1)throw new Error('Payout packet could not enter one-time MetaMask recovery');await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  async recordTransactionHash(packetId:string,transactionHash:Hex,now=Date.now()):Promise<void>{if(!/^0x[0-9a-f]{64}$/i.test(transactionHash))throw new Error('MetaMask did not return a transaction hash');const client=await this.pool.connect();try{await client.query('BEGIN');const changed=await client.query(`UPDATE base_metamask_payout_submissions SET state=CASE WHEN state='CONFIRMED' THEN 'CONFIRMED' ELSE 'SUBMITTED' END,transaction_hash=COALESCE(transaction_hash,$2),response_recorded_at=COALESCE(response_recorded_at,$3),recovery_reason=NULL,updated_at=$3 WHERE packet_id=$1 AND state IN ('SUBMISSION_STARTED','RECOVERY_REQUIRED','SUBMITTED','CONFIRMED') AND (transaction_hash IS NULL OR transaction_hash=$2)`,[packetId,Buffer.from(transactionHash.slice(2),'hex'),new Date(now)]);if(changed.rowCount!==1)throw new Error('MetaMask payout response is duplicate, conflicting, or not recoverable');const parent=await client.query(`UPDATE base_payout_signing_packets SET state=CASE WHEN state='CONFIRMED' THEN 'CONFIRMED' ELSE 'SUBMITTED' END,signed_transaction_hash=COALESCE(signed_transaction_hash,$2),updated_at=$3 WHERE packet_id=$1 AND state IN ('RECOVERY_REQUIRED','SUBMITTED','CONFIRMED') AND submission_method='METAMASK' AND (signed_transaction_hash IS NULL OR signed_transaction_hash=$2)`,[packetId,Buffer.from(transactionHash.slice(2),'hex'),new Date(now)]);if(parent.rowCount!==1)throw new Error('Payout packet hash recovery is inconsistent');await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  async recordRejection(packetId:string,errorCode:number,now=Date.now()):Promise<void>{if(errorCode!==4001)throw new Error('Only an explicit MetaMask user rejection is terminal; ambiguous errors require recovery');const client=await this.pool.connect();try{await client.query('BEGIN');const changed=await client.query(`UPDATE base_metamask_payout_submissions SET state='REJECTED',rejection_code=4001,updated_at=$2 WHERE packet_id=$1 AND state='SUBMISSION_STARTED'`,[packetId,new Date(now)]);if(changed.rowCount!==1)throw new Error('MetaMask payout is not awaiting an explicit response');const parent=await client.query(`UPDATE base_payout_signing_packets SET state='CANCELLED',updated_at=$2 WHERE packet_id=$1 AND state='RECOVERY_REQUIRED' AND submission_method='METAMASK'`,[packetId,new Date(now)]);if(parent.rowCount!==1)throw new Error('Rejected MetaMask payout packet is inconsistent');await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  async requireRecovery(packetId:string,reason:string,now=Date.now()):Promise<void>{if(!reason.trim())throw new Error('Recovery reason is required');const client=await this.pool.connect();try{await client.query('BEGIN');const result=await client.query(`UPDATE base_metamask_payout_submissions SET state='RECOVERY_REQUIRED',recovery_reason=$2,updated_at=$3 WHERE packet_id=$1 AND state IN ('SUBMISSION_STARTED','SUBMITTED')`,[packetId,reason,new Date(now)]);if(result.rowCount!==1)throw new Error('MetaMask payout is not an ambiguous or reorg-affected submission');const parent=await client.query(`UPDATE base_payout_signing_packets SET state='RECOVERY_REQUIRED',updated_at=$2 WHERE packet_id=$1 AND state IN ('RECOVERY_REQUIRED','SUBMITTED') AND submission_method='METAMASK'`,[packetId,new Date(now)]);if(parent.rowCount!==1)throw new Error('Recovering MetaMask payout packet is inconsistent');await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  async markConfirmed(packetId:string,transactionHash:Hex,now=Date.now()):Promise<void>{const client=await this.pool.connect();try{await client.query('BEGIN');const changed=await client.query(`UPDATE base_metamask_payout_submissions SET state='CONFIRMED',updated_at=$3 WHERE packet_id=$1 AND state IN ('SUBMITTED','CONFIRMED') AND transaction_hash=$2`,[packetId,Buffer.from(transactionHash.slice(2),'hex'),new Date(now)]);if(changed.rowCount!==1)throw new Error('Only the exact submitted MetaMask payout can be confirmed');const parent=await client.query(`UPDATE base_payout_signing_packets SET state='CONFIRMED',updated_at=$3 WHERE packet_id=$1 AND state IN ('SUBMITTED','CONFIRMED') AND signed_transaction_hash=$2`,[packetId,Buffer.from(transactionHash.slice(2),'hex'),new Date(now)]);if(parent.rowCount!==1)throw new Error('Confirmed MetaMask payout packet is inconsistent');await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
}
