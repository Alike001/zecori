import type { Pool } from 'pg';
import type { Hex } from 'viem';
import { assertBasePayoutPacket, assertBasePayoutPacketIntegrity, PostgresBasePayoutPacketStore, type BasePayoutSigningPacket } from './base-payout-signing-packet.ts';
import { expectedMetaMaskPayoutConfirmation, PostgresMetaMaskPayoutStore, recoverMetaMaskPayoutHash, rehearseMetaMaskPayout, type MetaMaskProvider } from './metamask-payout.ts';
import { verifyBaseSepoliaTransaction } from './base-sepolia-verifier.ts';
import type { RpcCall } from './rpc-client.ts';
import { PostgresSettlementStore } from './postgres-settlement-store.ts';
import type { OperatorControlStore } from './operator-control.ts';
import { verifyZcashTransaction } from './zcash-verifier.ts';

export type WalletObservations = Record<string, unknown>;
export function observedProvider(values: WalletObservations): MetaMaskProvider {
  return {async request({method,params}) {
    const key=method==='eth_getTransactionCount'?`${method}:${params?.[1]}`:method;
    if (!Object.hasOwn(values,key)) throw new Error(`Missing wallet observation: ${key}`);
    return values[key];
  }};
}

// This service is imported only by the private loopback operator entry point.
export class PrivatePayoutService {
  readonly packets: PostgresBasePayoutPacketStore;
  private readonly provider: MetaMaskProvider;
  private readonly input: {
    pool: Pool; settlements: PostgresSettlementStore; controls: Pick<OperatorControlStore,'verifyOperatorPayload'|'signReceipt'|'verifyReceipt'>;
    operatorId: string; lpSender: string; rpc: RpcCall; approvedPacketId?: string;
    sourceVerifier?: typeof verifyZcashTransaction;
  };
  constructor(input: PrivatePayoutService['input']) {
    this.input=input;
    if (!input.operatorId.trim()) throw new Error('Named operator is required');
    this.packets=new PostgresBasePayoutPacketStore(input.pool);
    this.provider={request: ({method,params})=>input.rpc(method,[...(params??[])])};
  }
  async preview(packetId:string) {
    const packet=await this.packets.load(packetId); assertBasePayoutPacketIntegrity(packet);
    if(packet.sender.toLowerCase()!==this.input.lpSender.toLowerCase())throw new Error('Configured LP sender differs from packet');
    const result=await this.input.pool.query(`SELECT p.state AS packet_state,s.state AS submission_state,encode(s.transaction_hash,'hex') AS transaction_hash,s.recovery_reason,s.submission_started_at FROM base_payout_signing_packets p LEFT JOIN base_metamask_payout_submissions s USING(packet_id) WHERE p.packet_id=$1`,[packetId]);
    return {packet,journal:result.rows[0],progress:await this.input.settlements.payoutProgress(packet.orderId),operatorId:this.input.operatorId,broadcastApproved:this.input.approvedPacketId===packetId,confirmation:expectedMetaMaskPayoutConfirmation(packet)};
  }
  private async preflight(packet:BasePayoutSigningPacket,observations:WalletObservations) {
    assertBasePayoutPacket(packet);
    const wallet=await rehearseMetaMaskPayout(packet,observedProvider(observations));
    const independent=await rehearseMetaMaskPayout(packet,{request: request=>request.method==='eth_accounts'?Promise.resolve([packet.sender]):this.provider.request(request)});
    if(JSON.stringify(wallet.observed)!==JSON.stringify(independent.observed)||wallet.requestDigest!==independent.requestDigest)throw new Error('Wallet and independent Base RPC observations disagree');
    return independent;
  }
  async rehearse(packetId:string,observations:WalletObservations) {
    const {packet}=await this.preview(packetId);
    await this.input.settlements.payoutPacketOrder(packet.orderId,packet.authorizationId);
    const rehearsal=await this.preflight(packet,observations);
    // Repeated read-only preflights do not change the original immutable journal.
    const existing=await this.input.pool.query(`SELECT state,encode(request_digest,'hex') AS digest FROM base_metamask_payout_submissions WHERE packet_id=$1`,[packetId]);
    if(!existing.rowCount)await new PostgresMetaMaskPayoutStore(this.input.pool).recordRehearsal(rehearsal);
    else if(existing.rows[0].state!=='REHEARSED'||existing.rows[0].digest!==rehearsal.requestDigest)throw new Error('Existing attempt requires reconciliation; no new prompt permitted');
    return rehearsal;
  }
  async begin(packetId:string,observations:WalletObservations,confirmation:string) {
    if(this.input.approvedPacketId!==packetId)throw new Error('Broadcast is disabled: separate approval for this exact packet is required');
    const {packet}=await this.preview(packetId);
    if(confirmation!==expectedMetaMaskPayoutConfirmation(packet))throw new Error('Exact payout confirmation is required');
    const rehearsal=await this.preflight(packet,observations);
    const version=await this.input.settlements.checkPayoutSource(packet.orderId,this.input.sourceVerifier);
    const journal=new PostgresMetaMaskPayoutStore(this.input.pool,async(client,id,now)=>{
      if(id!==packetId)throw new Error('Packet changed');
      await this.input.settlements.validatePayoutSubmission(client,packet,this.input.operatorId,(domain,value,signature)=>this.input.controls.verifyOperatorPayload(domain,value,signature),version,now);
    });
    // Atomic one-time transition commits before the browser can call MetaMask.
    await journal.beginSubmission(packetId,rehearsal.requestDigest);
    return {transaction:rehearsal.transaction,packetDigest:packet.packetDigest};
  }
  async capture(packetId:string,hash:Hex) {
    const {packet}=await this.preview(packetId);
    // Save a returned hash before a slow/missing RPC response or order update can fail.
    await new PostgresMetaMaskPayoutStore(this.input.pool).recordTransactionHash(packetId,hash);
    return this.link(packet,hash);
  }
  private async link(packet:BasePayoutSigningPacket,hash:Hex) {
    await recoverMetaMaskPayoutHash({packet,provider:this.provider,store:new PostgresMetaMaskPayoutStore(this.input.pool),transactionHash:hash,confirmation:`RECOVER BASE-84532 ${packet.packetId} ${hash.toLowerCase()} NO-RETRY`});
    await this.input.settlements.recordPayout(packet.orderId,this.input.operatorId,hash);
    return {transactionHash:hash,linked:true,confirmed:false};
  }
  async recover(packetId:string,hash:Hex,confirmation:string) {
    const {packet}=await this.preview(packetId);
    await recoverMetaMaskPayoutHash({packet,provider:this.provider,store:new PostgresMetaMaskPayoutStore(this.input.pool),transactionHash:hash,confirmation});
    return this.link(packet,hash);
  }
  async outcome(packetId:string,code:unknown) {
    await this.preview(packetId); const journal=new PostgresMetaMaskPayoutStore(this.input.pool);
    if(code===4001)await journal.recordRejection(packetId,4001);
    else await journal.requireRecovery(packetId,'operator-browser-response-ambiguous');
    return {state:code===4001?'REJECTED':'RECOVERY_REQUIRED'};
  }
  async reconcile(packetId:string) {
    const view=await this.preview(packetId);
    const {packet,journal}=view;
    const [chainId,latestNonce,pendingNonce]=await Promise.all([
      this.input.rpc<string>('eth_chainId'),this.input.rpc<string>('eth_getTransactionCount',[packet.sender,'latest']),this.input.rpc<string>('eth_getTransactionCount',[packet.sender,'pending']),
    ]);
    if(BigInt(chainId)!==84532n)throw new Error('Reconciliation RPC is not Base Sepolia');
    const hash=journal.transaction_hash?`0x${journal.transaction_hash}`:undefined;
    const transaction=hash?await this.input.rpc('eth_getTransactionByHash',[hash]):null;
    const receipt=hash?await this.input.rpc('eth_getTransactionReceipt',[hash]):null;
    return {...view,chain:{chainId,latestNonce,pendingNonce,transaction,receipt},automaticRetryPermitted:false};
  }
  async finish(packetId:string) {
    const {packet,progress}=await this.preview(packetId);
    const hash=await this.packets.transactionHash(packet.orderId);
    const verifyDestination=async()=>verifyBaseSepoliaTransaction({orderId:packet.orderId,transactionId:hash,recipient:packet.recipient,amountAtomic:packet.amountAtomic,expectedSender:packet.sender,minimumConfirmations:3,expectedTransaction:packet},{rpc:this.input.rpc});
    await this.input.settlements.checkPayoutSource(packet.orderId,this.input.sourceVerifier);
    let receiptId=progress.receiptId;
    if(progress.status!=='COMPLETED')receiptId=await this.input.settlements.verifyPayout(packet.orderId,value=>this.input.controls.signReceipt(value),async request=>{
      if(request.transactionId.toLowerCase()!==hash.toLowerCase())throw new Error('Order hash differs from persisted packet hash');
      await this.input.settlements.checkPayoutSource(packet.orderId,this.input.sourceVerifier);
      return verifyDestination();
    });
    else await verifyDestination();
    if(!receiptId)throw new Error('Linked receipt is missing');
    await this.input.settlements.verifyReceiptAuthenticity(receiptId,(value,signature)=>this.input.controls.verifyReceipt(value,signature));
    await new PostgresMetaMaskPayoutStore(this.input.pool).markConfirmed(packetId,hash);
    return {receiptId,authentic:true,sourceAndDestinationVerified:true};
  }
}
