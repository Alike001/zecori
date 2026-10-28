import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { getAddress } from 'viem';
import { createPostgresPool, migrateDatabase } from './postgres.ts';
import { PostgresTestVariableQuoteStore } from './postgres-test-variable-quote.ts';
import { TEST_QUOTE_TOKEN_CONTRACT, type ApprovedTestRate } from './test-variable-quote.ts';

const databaseUrl=process.env.POSTGRES_TEST_URL;
const recipient=getAddress('0x1234567890abcdef1234567890abcdef12345678');
const now=Date.parse('2026-10-28T10:15:00.000Z');
function rate(overrides:Partial<ApprovedTestRate>={}):ApprovedTestRate{return {
  providerId:'independently-approved-test-lp',approvalId:`approval-${randomUUID()}`,
  approvedAt:'2026-10-28T10:00:00.000Z',expiresAt:'2026-10-28T11:00:00.000Z',
  destinationAtomicNumerator:'1',sourceAtomicDenominator:'1',feeBps:25,fixedFeeDestinationAtomic:'7',
  minimumDestinationAtomic:'1',minimumSourceAtomic:'1000000',maximumSourceAtomic:'5000000',
  liquidityCapacityDestinationAtomic:'20000000',...overrides,
};}

test('TEST-ONLY PostgreSQL quotes bind three atomic amounts and survive restart', {skip:!databaseUrl}, async t=>{
  const pool=createPostgresPool(databaseUrl);await migrateDatabase(pool);t.after(async()=>pool.end());
  const approved=rate();const store=new PostgresTestVariableQuoteStore(pool);await store.registerApprovedRate(approved);
  const cases=[['1000000','997493'],['2000000','1994993'],['5000000','4987493']] as const;
  for(const [source,destination] of cases){const quote=await store.quote({approvalId:approved.approvalId,orderId:randomUUID(),destinationRecipient:recipient,sourceAtomic:source,now});assert.equal(quote.destinationAtomic,destination);assert.equal(quote.destinationChainId,84532);assert.equal(quote.destinationTokenContract,TEST_QUOTE_TOKEN_CONTRACT);}
  const restartedPool=createPostgresPool(databaseUrl);const restarted=new PostgresTestVariableQuoteStore(restartedPool);t.after(async()=>restartedPool.end());
  const orderId=randomUUID();const first=await store.quote({approvalId:approved.approvalId,orderId,destinationRecipient:recipient,sourceAtomic:'1000000',now});
  const second=await restarted.quote({approvalId:approved.approvalId,orderId,destinationRecipient:recipient,sourceAtomic:'1000000',now});assert.equal(second.quoteId,first.quoteId);
});

test('TEST-ONLY reservations serialize concurrent liquidity and recover expiry', {skip:!databaseUrl}, async t=>{
  const pool=createPostgresPool(databaseUrl);await migrateDatabase(pool);t.after(async()=>pool.end());
  const approved=rate({liquidityCapacityDestinationAtomic:'997493'});const store=new PostgresTestVariableQuoteStore(pool,1000);await store.registerApprovedRate(approved);
  const attempts=await Promise.allSettled([1,2].map(()=>store.quote({approvalId:approved.approvalId,orderId:randomUUID(),destinationRecipient:recipient,sourceAtomic:'1000000',now})));
  assert.equal(attempts.filter(item=>item.status==='fulfilled').length,1);assert.equal(attempts.filter(item=>item.status==='rejected').length,1);
  assert.equal(await store.releaseExpired(now+1000),1);
  const recovered=await store.quote({approvalId:approved.approvalId,orderId:randomUUID(),destinationRecipient:recipient,sourceAtomic:'1000000',now:now+1000});assert.equal(recovered.status,'RESERVED');
});

test('TEST-ONLY quote consumption rejects wrong bindings, duplicates, and imprecise payment', {skip:!databaseUrl}, async t=>{
  const pool=createPostgresPool(databaseUrl);await migrateDatabase(pool);t.after(async()=>pool.end());const approved=rate();const store=new PostgresTestVariableQuoteStore(pool);await store.registerApprovedRate(approved);
  const orderId=randomUUID();const quote=await store.quote({approvalId:approved.approvalId,orderId,destinationRecipient:recipient,sourceAtomic:'1000000',now});
  assert.equal(await store.assessSourcePayment(quote.quoteId,'999999'),'UNDERPAYMENT');assert.equal(await store.assessSourcePayment(quote.quoteId,'1000000'),'EXACT');assert.equal(await store.assessSourcePayment(quote.quoteId,'1000001'),'OVERPAYMENT');
  await assert.rejects(store.consume({quoteId:quote.quoteId,orderId,destinationRecipient:recipient,destinationChainId:1,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,observedSourceAtomic:'1000000',now}),/exact order/);
  await assert.rejects(store.consume({quoteId:quote.quoteId,orderId,destinationRecipient:recipient,destinationChainId:84532,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,observedSourceAtomic:'999999',now}),/underpayment/);
  await assert.rejects(store.consume({quoteId:quote.quoteId,orderId,destinationRecipient:recipient,destinationChainId:84532,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,observedSourceAtomic:'1000001',now}),/overpayment/);
  const consumed=await store.consume({quoteId:quote.quoteId,orderId,destinationRecipient:recipient,destinationChainId:84532,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,observedSourceAtomic:'1000000',now});assert.equal(consumed.status,'CONSUMED');
  await assert.rejects(store.consume({quoteId:quote.quoteId,orderId,destinationRecipient:recipient,destinationChainId:84532,destinationTokenContract:TEST_QUOTE_TOKEN_CONTRACT,observedSourceAtomic:'1000000',now}),/not active/);
});
