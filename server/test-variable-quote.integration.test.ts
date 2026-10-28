import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getAddress } from 'viem';
import { createPostgresPool, migrateDatabase } from './postgres.ts';
import { PostgresTestVariableQuoteStore } from './postgres-test-variable-quote.ts';
import { TEST_QUOTE_TOKEN_CONTRACT, type ApprovedTestRate } from './test-variable-quote.ts';

const databaseUrl=process.env.POSTGRES_TEST_URL;
const recipient=getAddress('0x1234567890abcdef1234567890abcdef12345678');
const now=Date.parse('2026-10-28T10:15:00.000Z');
const sourceAllocation={sourceReceiver:`utest1${'a'.repeat(64)}`,sourceDiversifierIndex:'42',sourceNotBeforeHeight:500};
function rate(overrides:Partial<ApprovedTestRate>={}):ApprovedTestRate{return {
  providerId:'independently-approved-test-lp',approvalId:`approval-${randomUUID()}`,
  approvedAt:'2026-10-28T10:00:00.000Z',expiresAt:'2026-10-28T11:00:00.000Z',
  destinationAtomicNumerator:'1',sourceAtomicDenominator:'1',feeBps:25,fixedFeeDestinationAtomic:'7',
  minimumDestinationAtomic:'1',minimumSourceAtomic:'1000000',maximumSourceAtomic:'5000000',
  liquidityCapacityDestinationAtomic:'20000000',...overrides,
};}
async function ownerRequest(pool:ReturnType<typeof createPostgresPool>,approvalId:string,sourceAtomic:string,destinationAtomic:string){
  const ownerUserId=randomUUID(),orderId=randomUUID(),destinationIntentId=randomUUID(),challengeId=randomUUID();
  const recipientFingerprint=createHash('sha256').update(recipient.toLowerCase()).digest();
  await pool.query(`INSERT INTO users(user_id,display_name,status,activated_at) VALUES($1,'TEST-ONLY quote owner','ACTIVE',now())`,[ownerUserId]);
  await pool.query(`INSERT INTO public_order_requests(request_id,owner_session_hash,owner_user_id,destination_binding_version,status,created_at,updated_at,expires_at,legacy_destination_recipient,immutable_terms)
    VALUES($1,$2,$3,2,'AWAITING_OPERATOR',$4,$4,$5,NULL,$6)`,[orderId,randomBytes(32),ownerUserId,new Date(now),new Date(now+30*60_000),{classification:'operator-approved-variable-test-disabled',sourceAtomic,destinationAtomic,rateApprovalId:approvalId}]);
  await pool.query(`INSERT INTO destination_intents(intent_id,request_id,owner_user_id,route_id,network,chain_id,token_contract,amount_atomic,recipient_fingerprint,encrypted_intent,encryption_key_version,consent_version,consent_digest,consent_confirmed_at,wallet_control_verification,status,created_at,expires_at)
    VALUES($1,$2,$3,'zcash-testnet-to-base-sepolia-variable-test-disabled','base-sepolia',84532,$4,$5,$6,$7,1,'base-destination-intent-v1',$8,$9,'NOT_PERFORMED','CONFIRMED',$9,$10)`,[destinationIntentId,orderId,ownerUserId,TEST_QUOTE_TOKEN_CONTRACT,destinationAtomic,recipientFingerprint,randomBytes(64),randomBytes(32),new Date(now),new Date(now+30*60_000)]);
  await pool.query(`INSERT INTO destination_wallet_challenges(challenge_id,intent_id,owner_user_id,session_hash,recipient_fingerprint,nonce_hash,encrypted_challenge,encryption_key_version,issued_at,expires_at,consumed_at,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$8,'VERIFIED')`,[challengeId,destinationIntentId,ownerUserId,randomBytes(32),recipientFingerprint,randomBytes(32),randomBytes(64),new Date(now),new Date(now+5*60_000)]);
  await pool.query(`INSERT INTO destination_wallet_proofs(proof_id,challenge_id,intent_id,owner_user_id,recipient_fingerprint,method,signature_fingerprint,typed_data_digest,encrypted_proof,encryption_key_version,verification_status,verified_at,verified_block_number,verified_block_hash,last_checked_at)
    VALUES($1,$2,$3,$4,$5,'EIP712_EOA',$6,$7,$8,1,'VERIFIED',$9,1,$10,$9)`,[randomUUID(),challengeId,destinationIntentId,ownerUserId,recipientFingerprint,randomBytes(32),randomBytes(32),randomBytes(64),new Date(now),randomBytes(32)]);
  return {ownerUserId,orderId,destinationIntentId};
}
function sourceEvidence(orderId:string,transactionId:string,amountZatoshis='1000000',confirmations=1,blockTime=Math.floor((now+500)/1000)){
  return {orderId,transactionId,network:'zcash-testnet' as const,receiver:sourceAllocation.sourceReceiver,amount:'0.01',amountZatoshis,pool:'ironwood' as const,status:'mined' as const,confirmations,blockHeight:510,blockHash:'c'.repeat(64),blockTime,outputIndex:0,diversifierIndex:sourceAllocation.sourceDiversifierIndex,shielded:true as const,independentlyVerified:true as const};
}

test('TEST-ONLY PostgreSQL quotes bind three atomic amounts and survive restart', {skip:!databaseUrl}, async t=>{
  const pool=createPostgresPool(databaseUrl);await migrateDatabase(pool);t.after(async()=>pool.end());
  const approved=rate();const store=new PostgresTestVariableQuoteStore(pool);await store.registerApprovedRate(approved);
  const cases=[['1000000','997493'],['2000000','1994993'],['5000000','4987493']] as const;
  for(const [source,destination] of cases){const binding=await ownerRequest(pool,approved.approvalId,source,destination);const quote=await store.quote({approvalId:approved.approvalId,...binding,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:source,now});assert.equal(quote.destinationAtomic,destination);assert.equal(quote.destinationChainId,84532);assert.equal(quote.destinationTokenContract,TEST_QUOTE_TOKEN_CONTRACT);}
  const restartedPool=createPostgresPool(databaseUrl);const restarted=new PostgresTestVariableQuoteStore(restartedPool);t.after(async()=>restartedPool.end());
  const binding=await ownerRequest(pool,approved.approvalId,'1000000','997493');const first=await store.quote({approvalId:approved.approvalId,...binding,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:'1000000',now});
  const second=await restarted.quote({approvalId:approved.approvalId,...binding,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:'1000000',now});assert.equal(second.quoteId,first.quoteId);
});

test('TEST-ONLY reservations serialize concurrent liquidity and recover expiry', {skip:!databaseUrl}, async t=>{
  const pool=createPostgresPool(databaseUrl);await migrateDatabase(pool);t.after(async()=>pool.end());
  const approved=rate({liquidityCapacityDestinationAtomic:'997493'});const store=new PostgresTestVariableQuoteStore(pool,1000);await store.registerApprovedRate(approved);
  const bindings=await Promise.all([1,2].map(()=>ownerRequest(pool,approved.approvalId,'1000000','997493')));const attempts=await Promise.allSettled(bindings.map(binding=>store.quote({approvalId:approved.approvalId,...binding,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:'1000000',now})));
  assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);assert.equal(attempts.filter(item=>item.status==='rejected').length,1);
  assert.equal(await store.releaseExpired(now+1000),1);
  const recoveredBinding=await ownerRequest(pool,approved.approvalId,'1000000','997493');const recovered=await store.quote({approvalId:approved.approvalId,...recoveredBinding,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:'1000000',now:now+1000});assert.equal(recovered.status,'RESERVED');
});

test('TEST-ONLY quote consumption rejects wrong bindings, duplicates, and imprecise payment', {skip:!databaseUrl}, async t=>{
  const pool=createPostgresPool(databaseUrl);await migrateDatabase(pool);t.after(async()=>pool.end());const approved=rate();const store=new PostgresTestVariableQuoteStore(pool);await store.registerApprovedRate(approved);
  const binding=await ownerRequest(pool,approved.approvalId,'1000000','997493');const {orderId}=binding;const quote=await store.quote({approvalId:approved.approvalId,...binding,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:'1000000',now});
  assert.equal(await store.assessSourcePayment(quote.quoteId,'999999'),'UNDERPAYMENT');assert.equal(await store.assessSourcePayment(quote.quoteId,'1000000'),'EXACT');assert.equal(await store.assessSourcePayment(quote.quoteId,'1000001'),'OVERPAYMENT');
  const transactionId='1'.repeat(64);await store.observeSourcePayment({quoteId:quote.quoteId,orderId,transactionId,verifier:async()=>sourceEvidence(orderId,transactionId),now:now+500});
  await assert.rejects(store.consume({quoteId:quote.quoteId,orderId,destinationRecipient:recipient,destinationChainId:1,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,transactionId,verifier:async()=>sourceEvidence(orderId,transactionId,'1000000',10),now:now+1000}),/exact order/);
  await assert.rejects(store.consume({quoteId:quote.quoteId,orderId,destinationRecipient:recipient,destinationChainId:84532,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,transactionId,verifier:async()=>sourceEvidence(orderId,transactionId,'999999',10),now:now+1000}),/underpayment/);
  await assert.rejects(store.consume({quoteId:quote.quoteId,orderId,destinationRecipient:recipient,destinationChainId:84532,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,transactionId,verifier:async()=>sourceEvidence(orderId,transactionId,'1000001',10),now:now+1000}),/overpayment/);
  const consumed=await store.consume({quoteId:quote.quoteId,orderId,destinationRecipient:recipient,destinationChainId:84532,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,transactionId,verifier:async()=>sourceEvidence(orderId,transactionId,'1000000',10),now:now+1000});assert.equal(consumed.status,'CONSUMED');
  await assert.rejects(store.consume({quoteId:quote.quoteId,orderId,destinationRecipient:recipient,destinationChainId:84532,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,transactionId,verifier:async()=>sourceEvidence(orderId,transactionId,'1000000',10),now:now+1000}),/no timely detected/);
});

test('TEST-ONLY detected payment keeps liquidity after payment expiry while ten confirmations accumulate', {skip:!databaseUrl}, async t=>{
  const pool=createPostgresPool(databaseUrl);await migrateDatabase(pool);t.after(async()=>pool.end());const approved=rate({liquidityCapacityDestinationAtomic:'997493'});const store=new PostgresTestVariableQuoteStore(pool,1000,10*60_000);await store.registerApprovedRate(approved);
  const binding=await ownerRequest(pool,approved.approvalId,'1000000','997493');const quote=await store.quote({approvalId:approved.approvalId,...binding,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:'1000000',now});const transactionId='2'.repeat(64);
  const detected=await store.observeSourcePayment({quoteId:quote.quoteId,orderId:binding.orderId,transactionId,verifier:async()=>sourceEvidence(binding.orderId,transactionId,'1000000',1),now:now+500});assert.equal(detected.status,'SOURCE_DETECTED');
  assert.equal(await store.releaseExpired(now+1000),0);
  const competing=await ownerRequest(pool,approved.approvalId,'1000000','997493');await assert.rejects(store.quote({approvalId:approved.approvalId,...competing,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:'1000000',now:now+1000}),/liquidity/);
  const consumed=await store.consume({quoteId:quote.quoteId,orderId:binding.orderId,destinationRecipient:recipient,destinationChainId:84532,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,transactionId,verifier:async()=>sourceEvidence(binding.orderId,transactionId,'1000000',10),now:now+90_000});assert.equal(consumed.status,'CONSUMED');
});

test('TEST-ONLY late payments and source reorgs stay allocated for explicit recovery', {skip:!databaseUrl}, async t=>{
  const pool=createPostgresPool(databaseUrl);await migrateDatabase(pool);t.after(async()=>pool.end());const approved=rate({liquidityCapacityDestinationAtomic:'1994986'});const store=new PostgresTestVariableQuoteStore(pool,1000,10*60_000);await store.registerApprovedRate(approved);
  const lateBinding=await ownerRequest(pool,approved.approvalId,'1000000','997493');const lateQuote=await store.quote({approvalId:approved.approvalId,...lateBinding,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:'1000000',now});await store.releaseExpired(now+1000);const lateTx='3'.repeat(64);
  const late=await store.observeSourcePayment({quoteId:lateQuote.quoteId,orderId:lateBinding.orderId,transactionId:lateTx,verifier:async()=>sourceEvidence(lateBinding.orderId,lateTx,'1000000',1,Math.floor((now+2000)/1000)),now:now+2000});assert.equal(late.status,'RECOVERY_REQUIRED');
  await assert.rejects(store.consume({quoteId:lateQuote.quoteId,orderId:lateBinding.orderId,destinationRecipient:recipient,destinationChainId:84532,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,transactionId:lateTx,verifier:async()=>sourceEvidence(lateBinding.orderId,lateTx,'1000000',10),now:now+3000}),/no timely detected/);
  const reorgBinding=await ownerRequest(pool,approved.approvalId,'1000000','997493');const reorgQuote=await store.quote({approvalId:approved.approvalId,...reorgBinding,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:'1000000',now});const reorgTx='4'.repeat(64);await store.observeSourcePayment({quoteId:reorgQuote.quoteId,orderId:reorgBinding.orderId,transactionId:reorgTx,verifier:async()=>sourceEvidence(reorgBinding.orderId,reorgTx),now:now+500});await store.markSourceReorganization(reorgQuote.quoteId,'canonical block removed',now+600);assert.equal(await store.releaseExpired(now+1000),0);
});

test('TEST-ONLY rate revocation blocks new quotes but preserves immutable obligations and append-only history', {skip:!databaseUrl}, async t=>{
  const pool=createPostgresPool(databaseUrl);await migrateDatabase(pool);t.after(async()=>pool.end());const approved=rate();const store=new PostgresTestVariableQuoteStore(pool);await store.registerApprovedRate(approved,'test-rate-committee');
  const existingBinding=await ownerRequest(pool,approved.approvalId,'1000000','997493');const existing=await store.quote({approvalId:approved.approvalId,...existingBinding,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:'1000000',now});await store.revokeApprovedRate(approved.approvalId,'test-rate-committee','testnet inventory withdrawn',now+1);
  const blockedBinding=await ownerRequest(pool,approved.approvalId,'1000000','997493');await assert.rejects(store.quote({approvalId:approved.approvalId,...blockedBinding,...sourceAllocation,destinationRecipient:recipient,sourceAtomic:'1000000',now:now+2}),/revoked/);
  const tx='5'.repeat(64);await store.observeSourcePayment({quoteId:existing.quoteId,orderId:existingBinding.orderId,transactionId:tx,verifier:async()=>sourceEvidence(existingBinding.orderId,tx),now:now+500});const consumed=await store.consume({quoteId:existing.quoteId,orderId:existingBinding.orderId,destinationRecipient:recipient,destinationChainId:84532,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,transactionId:tx,verifier:async()=>sourceEvidence(existingBinding.orderId,tx,'1000000',10),now:now+1000});assert.equal(consumed.status,'CONSUMED');
  await assert.rejects(pool.query(`UPDATE test_variable_rate_approvals SET provider_id='changed-provider' WHERE approval_id=$1`,[approved.approvalId]),/immutable/);await assert.rejects(pool.query(`UPDATE test_variable_rate_approval_events SET reason='changed' WHERE approval_id=$1`,[approved.approvalId]),/append-only/);await assert.rejects(store.revokeApprovedRate(approved.approvalId,'test-rate-committee','again',now+2),/not APPROVED/);
  const history=await pool.query<{to_status:string}>(`SELECT to_status FROM test_variable_rate_approval_events WHERE approval_id=$1 ORDER BY event_id`,[approved.approvalId]);assert.deepEqual(history.rows.map(row=>row.to_status),['APPROVED','REVOKED']);
});
