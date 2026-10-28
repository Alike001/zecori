// Served exclusively by the authenticated loopback operator server. No wallet call on load.
export function packetTransaction(p) {
  const quantity=x=>`0x${BigInt(x).toString(16)}`;
  const calldata=`0xa9059cbb${p.recipient.slice(2).toLowerCase().padStart(64,'0')}${BigInt(p.amountAtomic).toString(16).padStart(64,'0')}`;
  if(p.chainId!==84532||p.tokenContract.toLowerCase()!=='0x036cbd53842c5426634e7929541ec2318f3dcf7e'||p.value!=='0'||p.calldata.toLowerCase()!==calldata)throw Error('Packet transfer fields are inconsistent');
  return {from:p.sender,to:p.tokenContract,value:'0x0',data:p.calldata,nonce:quantity(p.nonce),gas:quantity(p.gasLimit),maxFeePerGas:quantity(p.maxFeePerGas),maxPriorityFeePerGas:quantity(p.maxPriorityFeePerGas)};
}
export async function walletObservations(provider,p) {
  const tx=packetTransaction(p),observations={};
  for(const [key,method,params] of [
    ['eth_chainId','eth_chainId',[]],['eth_accounts','eth_accounts',[]],
    ['eth_getTransactionCount:latest','eth_getTransactionCount',[p.sender,'latest']],['eth_getTransactionCount:pending','eth_getTransactionCount',[p.sender,'pending']],
    ['eth_getBlockByNumber','eth_getBlockByNumber',['latest',false]],['eth_estimateGas','eth_estimateGas',[tx,'pending']],['eth_getBalance','eth_getBalance',[p.sender,'pending']],
    ['eth_call','eth_call',[{to:p.tokenContract,data:`0x70a08231${p.sender.slice(2).toLowerCase().padStart(64,'0')}`},'pending']],
  ]) observations[key]=await provider.request({method,params});
  if(BigInt(observations.eth_chainId)!==84532n||observations.eth_accounts[0]?.toLowerCase()!==p.sender.toLowerCase())throw Error('Wrong MetaMask account or chain');
  return observations;
}
export function createSubmission({provider,api,packet,onStarted=()=>{},onHash=()=>{}}) {
  let attempted=false;
  return async confirmation=>{
    if(attempted)throw Error('One-time action already attempted; use reconciliation');
    attempted=true;onStarted();
    if(Date.parse(packet.expiresAt)<=Date.now())throw Error('Packet expired; new signing is forbidden');
    const observations=await walletObservations(provider,packet);
    const begun=await api('/api/begin',{packetId:packet.packetId,observations,confirmation});
    if(begun.packetDigest!==packet.packetDigest||JSON.stringify(begun.transaction)!==JSON.stringify(packetTransaction(packet)))throw Error('Server transaction changed; recovery required');
    if(Date.parse(packet.expiresAt)<=Date.now())throw Error('Packet expired after journal start; reconcile without signing');
    const chain=await provider.request({method:'eth_chainId'}),accounts=await provider.request({method:'eth_accounts'});
    if(BigInt(chain)!==84532n||accounts[0]?.toLowerCase()!==packet.sender.toLowerCase())throw Error('MetaMask changed after journal start; reconcile without signing');
    let hash;
    try {hash=await provider.request({method:'eth_sendTransaction',params:[Object.freeze(begun.transaction)]});}
    catch(error){await api('/api/outcome',{packetId:packet.packetId,code:error?.code===4001?4001:null}).catch(()=>{});throw Error(error?.code===4001?'Operator rejected; attempt closed':'Ambiguous wallet response; inspect original activity. Never resend.');}
    onHash(hash);
    // A failed hash/order write must not classify a successful wallet response as rejection.
    return api('/api/hash',{packetId:packet.packetId,hash});
  };
}
if(typeof document!=='undefined') {
  const $=id=>document.getElementById(id);let csrf,preview,submit;
  const status=value=>{$('status').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);};
  const api=async(path,data)=>{
    const headers={'Content-Type':'application/json','X-CSRF-Token':csrf};
    if(data&&path!=='/api/login') {const challenge=await fetch('/api/challenge',{cache:'no-store'}).then(r=>r.json());headers['X-Operator-Nonce']=challenge.nonce;}
    const response=await fetch(path,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined,cache:'no-store'});const value=await response.json();if(!response.ok)throw Error(value.error);return value;
  };
  const action=fn=>async event=>{event.preventDefault();try{await fn();}catch(error){status(error.message);}};
  $('login').onsubmit=action(async()=>{const result=await api('/api/login',{token:$('token').value});$('token').value='';csrf=result.csrf;$('login').hidden=true;$('workspace').hidden=false;status('Authenticated. Wallet remains disconnected.');});
  $('load').onclick=action(async()=>{preview=await api(`/api/preview?packet=${encodeURIComponent($('packetId').value)}`);$('preview').textContent=JSON.stringify(preview,null,2);$('submit').disabled=true;$('rehearse').disabled=true;submit=undefined;});
  $('connect').onclick=action(async()=>{if(!preview)throw Error('Load the persisted packet first');if(!window.ethereum?.isMetaMask)throw Error('Use the private MetaMask operator browser profile');await window.ethereum.request({method:'eth_requestAccounts'});$('rehearse').disabled=false;status('Connected. Run read-only preflight.');});
  $('rehearse').onclick=action(async()=>{const observations=await walletObservations(window.ethereum,preview.packet);status(await api('/api/rehearse',{packetId:preview.packet.packetId,observations}));submit=createSubmission({provider:window.ethereum,api,packet:preview.packet,onStarted:()=>{$('submit').disabled=true;},onHash:hash=>{$('hash').value=hash;status(`Wallet returned ${hash}. Preserve this hash; linking is pending.`);}});$('submit').disabled=!preview.broadcastApproved;});
  $('submit').onclick=action(async()=>{if(!submit)throw Error('Run preflight first');status(await submit($('confirmation').value));});
  $('recover').onclick=action(async()=>status(await api('/api/recover',{packetId:$('packetId').value,hash:$('hash').value,confirmation:$('recovery').value})));
  $('finish').onclick=action(async()=>status(await api('/api/finish',{packetId:$('packetId').value})));
  $('reconcile').onclick=action(async()=>status(await api('/api/reconcile',{packetId:$('packetId').value})));
}
