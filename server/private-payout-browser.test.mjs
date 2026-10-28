import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as netServer } from 'node:net';
import { createPrivatePayoutServer } from './private-payout-server.ts';
import { prepareBasePayoutSigningPacket } from './base-payout-signing-packet.ts';
import { rehearseMetaMaskPayout,expectedMetaMaskPayoutConfirmation } from './metamask-payout.ts';
import { observedProvider } from './private-payout-service.ts';
import { activateOrder,attachSourceEvidence,authorizePayout,createOrder,queuePayoutApproval } from '../src/lib/order-coordinator.ts';
import { getAddress } from 'viem';

export function browserPacket() {
  const now=Date.now(),recipient=getAddress('0x1234567890abcdef1234567890abcdef12345678');
  const order=activateOrder(createOrder({allocationId:'test-allocation',destinationRecipient:recipient,sourceAmountZat:'1000000',expiresAt:new Date(now+1800000).toISOString()},{allocationId:'test-allocation',sourceReceiver:`utest1${'a'.repeat(64)}`,sourceDiversifierIndex:'42',sourceNotBeforeHeight:500},now,'00000000-0000-4000-8000-000000000111'),now);
  const source=attachSourceEvidence(order,{transactionId:'1'.repeat(64),verifiedAt:new Date(now).toISOString(),verification:'independent',verifier:'zcash-rpc-adapter',amountZatoshis:'1000000',outputIndex:0,diversifierIndex:'42',blockHeight:510,blockHash:'2'.repeat(64),blockTime:Math.floor(now/1000),confirmations:10},now);
  return prepareBasePayoutSigningPacket({order:authorizePayout(queuePayoutApproval(source),'operator-test','00000000-0000-4000-8000-000000000222',now),operatorConfig:{version:1,network:'base-sepolia',chainId:84532,lpSender:getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'),usdcReceiver:recipient,confirmedAt:new Date(now-1000).toISOString(),confirmationSource:'interactive-metamask'},authorizationId:'00000000-0000-4000-8000-000000000222',nonce:7,gasLimit:'65000',maxFeePerGas:'2000000000',maxPriorityFeePerGas:'1000000000',now});
}

test('TEST-ONLY headless browser executes real private HTTP adapter with an injected wallet and never a real wallet',async t=>{
  const packet=browserPacket(),hash=`0x${'45'.repeat(32)}`,token='b'.repeat(64),events=[];let started=false,failHash=false;
  const service={
    async preview(){return {packet};},
    async begin(id,observations,confirmation){assert.equal(id,packet.packetId);assert.equal(confirmation,expectedMetaMaskPayoutConfirmation(packet));if(started)throw Error('already started');const rehearsal=await rehearseMetaMaskPayout(packet,observedProvider(observations));started=true;events.push('journal-started');return {packetDigest:packet.packetDigest,transaction:rehearsal.transaction};},
    async capture(_id,value){events.push('hash-recorded');assert.equal(value,hash);if(failHash)throw Error('TEST-ONLY DB write failure after broadcast');return {linked:true};},
    async outcome(_id,code){events.push(code===4001?'rejected':'recovery-required');return {};},
  };
  const probe=netServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const server=createPrivatePayoutServer({service,port,loginToken:token});await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const profile=await mkdtemp(join(tmpdir(),'zecori-private-browser-'));
  const chrome=spawn(process.env.CHROME_BIN??'google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
  t.after(async()=>{chrome.kill('SIGTERM');await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('Chrome startup timed out')),15000);chrome.stderr.on('data',chunk=>{output+=chunk;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});chrome.once('error',reject);});
  const socket=new WebSocket(endpoint);t.after(()=>socket.close());let next=0;const pending=new Map();
  socket.onmessage=event=>{const value=JSON.parse(String(event.data));const callbacks=pending.get(value.id);if(callbacks){pending.delete(value.id);value.error?callbacks.reject(Error(value.error.message)):callbacks.resolve(value.result);}};
  await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  await send('Page.enable',{},sessionId);await send('Page.navigate',{url:`http://127.0.0.1:${port}`},sessionId);
  const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description);return value.result.value;};
  for(let i=0;i<100;i++){if(await evaluate("!!document.getElementById('login')"))break;await new Promise(r=>setTimeout(r,50));}
  assert.deepEqual(events,[],'page load cannot start a payment');
  await evaluate(`(async()=>{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:${JSON.stringify(token)}})});window.testCsrf=(await r.json()).csrf;})()`);
  for(const mode of ['success','wrong-chain','wrong-account','no-eth','no-usdc','nonce-conflict','modified','expired','reject','timeout','lost-response','hash-db-failure']) {
    started=false;failHash=mode==='hash-db-failure';events.length=0;
    const result=await evaluate(`(async()=>{
      const {createSubmission}=await import('/client.mjs');
      const packet=${JSON.stringify(packet)},mode=${JSON.stringify(mode)};let sends=0,hashSeen;
      if(mode==='modified')packet.calldata='0x';
      const provider={async request({method,params}){
        if(method==='eth_sendTransaction'){sends++;if(mode==='reject')throw {code:4001};if(mode==='timeout'||mode==='lost-response')throw Error('ambiguous response');return ${JSON.stringify(hash)};}
        if(method==='eth_getTransactionCount')return mode==='nonce-conflict'?'0x8':'0x7';
        return {eth_chainId:mode==='wrong-chain'?'0x1':'0x14a34',eth_accounts:[mode==='wrong-account'?'0x1111111111111111111111111111111111111111':packet.sender],eth_getBlockByNumber:{baseFeePerGas:'0x3b9aca00'},eth_estimateGas:'0xea60',eth_getBalance:mode==='no-eth'?'0x0':'0xde0b6b3a7640000',eth_call:mode==='no-usdc'?'0x0':'0x989680'}[method];
      }};
      const api=async(path,data)=>{if(mode==='expired'&&path==='/api/begin')throw Error('expired new-send');const {nonce}=await fetch('/api/challenge').then(r=>r.json());const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':window.testCsrf,'X-Operator-Nonce':nonce},body:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
      const submit=createSubmission({provider,api,packet,onHash:hash=>{hashSeen=hash;}});
      const results=await Promise.allSettled([submit(${JSON.stringify(expectedMetaMaskPayoutConfirmation(packet))}),submit(${JSON.stringify(expectedMetaMaskPayoutConfirmation(packet))})]);
      return {sends,hashSeen,results:results.map(r=>({status:r.status,error:r.reason?.message}))};
    })()`);
    const walletReached=['success','reject','timeout','lost-response','hash-db-failure'].includes(mode);
    assert.equal(result.sends,walletReached?1:0,mode);assert.equal(result.results[1].status,'rejected',`${mode} duplicate click`);
    if(mode==='success'){assert.equal(result.results[0].status,'fulfilled');assert.deepEqual(events,['journal-started','hash-recorded']);}
    else assert.equal(result.results[0].status,'rejected',mode);
    if(mode==='hash-db-failure'){assert.equal(result.hashSeen,hash);assert.deepEqual(events,['journal-started','hash-recorded']);}
    if(['timeout','lost-response','reject'].includes(mode))assert.deepEqual(events,['journal-started',mode==='reject'?'rejected':'recovery-required']);
  }
});
