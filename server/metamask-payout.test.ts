import assert from 'node:assert/strict';
import test from 'node:test';
import { getAddress } from 'viem';
import { activateOrder, attachSourceEvidence, authorizePayout, createOrder, queuePayoutApproval } from '../src/lib/order-coordinator.ts';
import { prepareBasePayoutSigningPacket } from './base-payout-signing-packet.ts';
import { classifyMetaMaskSubmissionError, createMetaMaskPayoutRequest, expectedMetaMaskPayoutConfirmation, expectedMetaMaskRecoveryConfirmation, REAL_METAMASK_BROADCAST_ENABLED, reconcileMetaMaskNonce, recoverMetaMaskPayoutHash, rehearseMetaMaskPayout, submitMetaMaskPayout, type MetaMaskPayoutSubmissionStore, type MetaMaskProvider } from './metamask-payout.ts';
import type { OperatorConfig } from './operator-config.ts';

const now=Date.parse('2026-10-28T12:00:00.000Z');
const sender=getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
const recipient=getAddress('0x1234567890abcdef1234567890abcdef12345678');
const operatorConfig:OperatorConfig={version:1,network:'base-sepolia',chainId:84532,lpSender:sender,usdcReceiver:getAddress('0xfedcbafedcbafedcbafedcbafedcbafedcbafedc'),confirmedAt:'2026-10-28T11:00:00.000Z',confirmationSource:'interactive-metamask'};

function packet(){const created=createOrder({allocationId:'allocation-fixture',destinationRecipient:recipient,sourceAmountZat:'1000000',expiresAt:new Date(now+30*60_000).toISOString()},{allocationId:'allocation-fixture',sourceReceiver:`utest1${'a'.repeat(64)}`,sourceDiversifierIndex:'42',sourceNotBeforeHeight:500},now,'00000000-0000-4000-8000-000000000111');const active=activateOrder(created,now+1);const sourced=attachSourceEvidence(active,{transactionId:'1'.repeat(64),verifiedAt:new Date(now+2).toISOString(),verification:'independent',verifier:'zcash-rpc-adapter',amountZatoshis:'1000000',outputIndex:0,diversifierIndex:'42',blockHeight:510,blockHash:'2'.repeat(64),blockTime:Math.floor(now/1000),confirmations:10},now+2);const approved=authorizePayout(queuePayoutApproval(sourced),'operator','00000000-0000-4000-8000-000000000222',now+3);return prepareBasePayoutSigningPacket({order:approved,operatorConfig,authorizationId:'00000000-0000-4000-8000-000000000222',nonce:7,gasLimit:'65000',maxFeePerGas:'2000000000',maxPriorityFeePerGas:'1000000000',now:now+4});}
function provider(overrides:Record<string,unknown>={}):MetaMaskProvider{return {async request({method,params}){const values:Record<string,unknown>={eth_chainId:'0x14a34',eth_accounts:[sender],eth_getBlockByNumber:{baseFeePerGas:'0x3b9aca00'},eth_estimateGas:'0xea60'};if(method==='eth_getTransactionCount')return params?.[1]==='latest'?'0x7':'0x7';return method in overrides?overrides[method]:values[method];}};}

test('TEST-ONLY MetaMask rehearsal binds every approved field without broadcasting',async()=>{const rehearsal=await rehearseMetaMaskPayout(packet(),provider(),now+5);assert.equal(rehearsal.observed.chainId,84532);assert.equal(rehearsal.transaction.from,sender);assert.equal(rehearsal.transaction.to,'0x036CbD53842c5426634e7929541eC2318f3dCF7e');assert.equal(rehearsal.transaction.value,'0x0');assert.equal(rehearsal.transaction.nonce,'0x7');assert.match(rehearsal.transaction.data,/^0xa9059cbb/);assert.equal(REAL_METAMASK_BROADCAST_ENABLED,false);assert.deepEqual(createMetaMaskPayoutRequest(rehearsal),{method:'eth_sendTransaction',params:[rehearsal.transaction],broadcasts:true,returns:'transaction-hash'});});

test('TEST-ONLY rehearsal rejects wrong network, sender, nonce, unsafe fees, changed packet and expiry',async()=>{const approved=packet();await assert.rejects(rehearseMetaMaskPayout(approved,provider({eth_chainId:'0x1'}),now+5),/chain 84532/);await assert.rejects(rehearseMetaMaskPayout(approved,provider({eth_accounts:[recipient]}),now+5),/LP sender/);const nonceProvider:MetaMaskProvider={async request(input){if(input.method==='eth_getTransactionCount')return input.params?.[1]==='latest'?'0x7':'0x8';return provider().request(input);}};await assert.rejects(rehearseMetaMaskPayout(approved,nonceProvider,now+5),/nonce conflicts/);await assert.rejects(rehearseMetaMaskPayout(approved,provider({eth_getBlockByNumber:{baseFeePerGas:'0x77359400'}}),now+5),/fee constraints/);await assert.rejects(rehearseMetaMaskPayout({...approved,recipient:sender},provider(),now+5),/digest/);await assert.rejects(rehearseMetaMaskPayout(approved,provider(),Date.parse(approved.expiresAt)),/expired/);});

test('TEST-ONLY ambiguous nonce reconciliation never authorizes an automatic retry',async()=>{const approved=packet();assert.equal(await reconcileMetaMaskNonce(approved,provider()),'UNOBSERVED');const pending:MetaMaskProvider={async request(input){if(input.method==='eth_getTransactionCount')return input.params?.[1]==='latest'?'0x7':'0x8';return provider().request(input);}};assert.equal(await reconcileMetaMaskNonce(approved,pending),'PENDING_OR_CONSUMED');const consumed:MetaMaskProvider={async request(input){if(input.method==='eth_getTransactionCount')return '0x8';return provider().request(input);}};assert.equal(await reconcileMetaMaskNonce(approved,consumed),'CONSUMED');});
test('TEST-ONLY only explicit MetaMask rejection is terminal; every ambiguous error requires recovery',()=>{assert.equal(classifyMetaMaskSubmissionError({code:4001}),'REJECTED');assert.equal(classifyMetaMaskSubmissionError({code:-32002}),'RECOVERY_REQUIRED');assert.equal(classifyMetaMaskSubmissionError(new Error('lost response')),'RECOVERY_REQUIRED');});

function submissionStore(events:string[]):MetaMaskPayoutSubmissionStore{return {
  async beginSubmission(){events.push('journal-started');},async recordTransactionHash(){events.push('hash-recorded');},
  async recordRejection(){events.push('rejected');},async requireRecovery(){events.push('recovery-required');},
};}

test('TEST-ONLY operator submission journals before the one wallet prompt and records only its hash',async()=>{
  const approved=packet(),rehearsal=await rehearseMetaMaskPayout(approved,provider(),now+5),events:string[]=[];const hash=`0x${'34'.repeat(32)}` as const;
  const wallet:MetaMaskProvider={async request(input){if(input.method==='eth_sendTransaction'){assert.deepEqual(events,['journal-started']);events.push('wallet-prompt');return hash;}return provider().request(input);}};
  assert.equal(await submitMetaMaskPayout({packet:approved,rehearsal,provider:wallet,store:submissionStore(events),confirmation:expectedMetaMaskPayoutConfirmation(approved),broadcastEnabled:true,now:now+6}),hash);
  assert.deepEqual(events,['journal-started','wallet-prompt','hash-recorded']);
});

test('TEST-ONLY rejection, ambiguity, crash state, deadline, confirmation, and repeat gates fail closed',async()=>{
  const approved=packet(),rehearsal=await rehearseMetaMaskPayout(approved,provider(),now+5);
  await assert.rejects(submitMetaMaskPayout({packet:approved,rehearsal,provider:provider(),store:submissionStore([]),confirmation:'wrong',broadcastEnabled:true,now:now+6}),/confirmation/);
  await assert.rejects(submitMetaMaskPayout({packet:approved,rehearsal,provider:provider({eth_sendTransaction:`0x${'45'.repeat(32)}`}),store:submissionStore([]),confirmation:expectedMetaMaskPayoutConfirmation(approved),broadcastEnabled:true,now:Date.parse(approved.expiresAt)}),/expired/);
  const rejected:string[]=[];await assert.rejects(submitMetaMaskPayout({packet:approved,rehearsal,provider:provider({eth_sendTransaction:undefined}),store:submissionStore(rejected),confirmation:expectedMetaMaskPayoutConfirmation(approved),broadcastEnabled:true,now:now+6}),/ambiguous/);assert.deepEqual(rejected,['journal-started','recovery-required']);
  const refusal:string[]=[];const rejecting:MetaMaskProvider={async request(input){if(input.method==='eth_sendTransaction')throw {code:4001};return provider().request(input);}};
  await assert.rejects(submitMetaMaskPayout({packet:approved,rehearsal,provider:rejecting,store:submissionStore(refusal),confirmation:expectedMetaMaskPayoutConfirmation(approved),broadcastEnabled:true,now:now+6}),/rejected/);assert.deepEqual(refusal,['journal-started','rejected']);
  const crash:string[]=[];let started=false;const once={...submissionStore(crash),async beginSubmission(){if(started)throw new Error('already started');started=true;crash.push('journal-started');}};
  const lost:MetaMaskProvider={async request(input){if(input.method==='eth_sendTransaction')throw new Error('browser crashed after prompt');return provider().request(input);}};
  await assert.rejects(submitMetaMaskPayout({packet:approved,rehearsal,provider:lost,store:once,confirmation:expectedMetaMaskPayoutConfirmation(approved),broadcastEnabled:true,now:now+6}),/ambiguous/);
  await assert.rejects(submitMetaMaskPayout({packet:approved,rehearsal,provider:lost,store:once,confirmation:expectedMetaMaskPayoutConfirmation(approved),broadcastEnabled:true,now:now+7}),/already started/);
});

test('TEST-ONLY recovery records an explicitly confirmed exact observed transaction without prompting or retrying',async()=>{
  const approved=packet(),hash=`0x${'56'.repeat(32)}` as const,events:string[]=[];
  const observed={hash,from:approved.sender,to:approved.tokenContract,chainId:'0x14a34',nonce:'0x7',value:'0x0',input:approved.calldata,gas:'0xfde8',maxFeePerGas:'0x77359400',maxPriorityFeePerGas:'0x3b9aca00'};
  const recoveryProvider:MetaMaskProvider={async request(input){assert.equal(input.method,'eth_getTransactionByHash');events.push('lookup');return observed;}};
  const store={async recordTransactionHash(){events.push('hash-recorded');}};
  assert.equal(await recoverMetaMaskPayoutHash({packet:approved,provider:recoveryProvider,store,transactionHash:hash,confirmation:expectedMetaMaskRecoveryConfirmation(approved,hash),now:now+6}),hash);
  assert.deepEqual(events,['lookup','hash-recorded']);
  await assert.rejects(recoverMetaMaskPayoutHash({packet:approved,provider:{async request(){return {...observed,to:recipient};}},store,transactionHash:hash,confirmation:expectedMetaMaskRecoveryConfirmation(approved,hash),now:now+6}),/does not match/);
});
