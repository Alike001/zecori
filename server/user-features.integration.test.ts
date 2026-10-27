import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createPostgresPool, migrateDatabase } from './postgres.ts';
import { DataEncryption } from './data-encryption.ts';
import { PostgresUserFeatures } from './user-features.ts';
import { PostgresPublicOrderRequestStore } from './public-order-store.ts';
import { fixedWalletReadinessIntent } from './wallet-intent.ts';

const databaseUrl=process.env.POSTGRES_TEST_URL;
async function user(pool:ReturnType<typeof createPostgresPool>){const id=randomUUID();await pool.query(`INSERT INTO users(user_id,display_name,status,activated_at) VALUES($1,'TEST-ONLY 09C account','ACTIVE',now())`,[id]);return id}
function authority(userId:string){return{userId,authenticatedAt:new Date().toISOString()}}

test('TEST-ONLY handles, contacts, request intents and inbox remain isolated, concurrent-safe and restart durable',{skip:!databaseUrl},async t=>{
  const pool=createPostgresPool(databaseUrl);await migrateDatabase(pool);t.after(()=>pool.end());
  const encryption=new DataEncryption({activeVersion:91,keys:new Map([[91,randomBytes(32)]])});const features=new PostgresUserFeatures(pool,encryption);
  for(;;){const drained=await features.dispatchOutbox(100);if(drained.delivered===0&&drained.dead===0)break;}
  const ownerA=await user(pool),ownerB=await user(pool),ownerC=await user(pool),rateOwner=await user(pool);const shared=`a${randomBytes(5).toString('hex')}`;
  assert.deepEqual(await features.availability(rateOwner,'admin'),{available:false});
  await assert.rejects(features.putHandle(authority(rateOwner),{candidate:'admin',expectedVersion:0,confirmation:'CLAIM @admin'}),/unavailable/i);
  for(let index=0;index<4;index+=1)await assert.rejects(features.createContact(rateOwner,{handle:`missing-${index}`,label:'TEST-ONLY miss'}),/not found/i);
  await assert.rejects(features.createContact(rateOwner,{handle:'missing-final',label:'TEST-ONLY limited'}),/limit/i);
  const concurrent=await Promise.allSettled([
    features.putHandle(authority(ownerA),{candidate:shared,expectedVersion:0,confirmation:`CLAIM @${shared}`}),
    features.putHandle(authority(ownerB),{candidate:shared,expectedVersion:0,confirmation:`CLAIM @${shared}`}),
  ]);
  assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);assert.equal(concurrent.filter(result=>result.status==='rejected').length,1);
  const claimedOwner=concurrent[0].status==='fulfilled'?ownerA:ownerB;const otherOwner=claimedOwner===ownerA?ownerB:ownerA;
  const targetHandle=await features.getHandle(claimedOwner);assert.ok(targetHandle);assert.equal(targetHandle.discoverable,false);
  await assert.rejects(features.createContact(ownerC,{handle:shared,label:'Hidden'}),/not found/i);
  const discoverable=await features.setDiscoverability(authority(claimedOwner),{discoverable:true,expectedVersion:targetHandle.version,confirmation:'MAKE HANDLE DISCOVERABLE'});assert.equal(discoverable.discoverable,true);
  const contact=await features.createContact(ownerC,{handle:shared,label:'TEST-ONLY private label'});assert.equal((await features.listContacts(ownerC))[0].label,'TEST-ONLY private label');assert.equal((await features.listContacts(otherOwner)).length,0);
  const request=await features.createHandleRequest(ownerC,{contactId:contact.contactId,confirmation:'REQUEST FIXED TEST ROUTE'});assert.equal(request.status,'REQUESTED');
  await assert.rejects(features.respondHandleRequest(otherOwner,request.intentId,{action:'ACCEPT',confirmation:'ACCEPT REQUEST — NO PAYMENT'}),/not found/i);
  const accepted=await features.respondHandleRequest(claimedOwner,request.intentId,{action:'ACCEPT',confirmation:'ACCEPT REQUEST — NO PAYMENT'});assert.equal(accepted.status,'ACCEPTED');
  await features.dispatchOutbox(100);
  const recipientInbox=await features.listInbox(claimedOwner,{});assert.ok(recipientInbox.items.some(item=>item.titleKey==='inbox.request.received'));assert.ok(JSON.stringify(recipientInbox).includes('destination')===false);
  const requesterInbox=await features.listInbox(ownerC,{});assert.ok(requesterInbox.items.some(item=>item.titleKey==='inbox.request.accepted'));const beforeReplay=[...recipientInbox.items,...requesterInbox.items].map(item=>item.inboxItemId).sort();await features.dispatchOutbox(100);const afterReplay=[...(await features.listInbox(claimedOwner,{})).items,...(await features.listInbox(ownerC,{})).items].map(item=>item.inboxItemId).sort();assert.deepEqual(afterReplay,beforeReplay,'replay is idempotent for both owners');const item=requesterInbox.items[0];
  await assert.rejects(features.setInboxRead(otherOwner,item.inboxItemId,true),/not found/i);await features.setInboxRead(ownerC,item.inboxItemId,true);assert.ok((await features.listInbox(ownerC,{})).items.find(value=>value.inboxItemId===item.inboxItemId)?.read);
  await assert.rejects(features.putHandle(authority(claimedOwner),{candidate:`b${randomBytes(5).toString('hex')}`,expectedVersion:discoverable.version,confirmation:'wrong'}),/30 days|confirm/i);
  const restartedPool=createPostgresPool(databaseUrl);t.after(()=>restartedPool.end());const restarted=new PostgresUserFeatures(restartedPool,encryption);assert.ok((await restarted.listInbox(ownerC,{})).items.length>0);
});

test('TEST-ONLY genuine order events create redacted idempotent inbox records and unknown events dead-letter',{skip:!databaseUrl},async t=>{
  const pool=createPostgresPool(databaseUrl);await migrateDatabase(pool);t.after(()=>pool.end());const encryption=new DataEncryption({activeVersion:92,keys:new Map([[92,randomBytes(32)]])});const features=new PostgresUserFeatures(pool,encryption);const owner=await user(pool);
  const orders=new PostgresPublicOrderRequestStore(pool,encryption);const request=await orders.create(owner,fixedWalletReadinessIntent(`0x${randomBytes(20).toString('hex')}`));
  await features.dispatchOutbox();const inbox=await features.listInbox(owner,{});const received=inbox.items.find(item=>item.requestId===request.id);assert.equal(received?.titleKey,'inbox.order.received');assert.doesNotMatch(JSON.stringify(received),/0x[0-9a-f]{40}|receiver|signature|txid/i);
  await pool.query(`INSERT INTO transactional_outbox(outbox_id,aggregate_type,aggregate_id,aggregate_version,event_type,recipient_user_id,privacy_class,payload,occurred_at,available_at,status) VALUES($1,'HANDLE',$2,999,'UNKNOWN_EVENT',$3,'OWNER_PRIVATE_REDACTED','{}',now(),now(),'PENDING')`,[randomUUID(),randomUUID(),owner]);
  const result=await features.dispatchOutbox();assert.equal(result.dead,1);const dead=await pool.query(`SELECT status,last_error_code FROM transactional_outbox WHERE event_type='UNKNOWN_EVENT' AND recipient_user_id=$1`,[owner]);assert.deepEqual(dead.rows[0],{status:'DEAD',last_error_code:'PRIVACY_SCHEMA_REJECTED'});
});
