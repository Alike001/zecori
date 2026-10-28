import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectBaseReadOnlyProvider, inspectZcashReadOnlyAdapter, requestDestinationControlSignature, subscribeInjectedWalletProviders, validateManualBaseRecipient } from './wallet-readiness.ts';

test('manual Base recipients require a complete non-zero address', () => {
  assert.equal(validateManualBaseRecipient('').code, 'NO_ACCOUNT');
  assert.equal(validateManualBaseRecipient('0x1234').code, 'INVALID_ACCOUNT');
  assert.equal(validateManualBaseRecipient(`0x${'0'.repeat(40)}`).code, 'INVALID_ACCOUNT');
  assert.equal(validateManualBaseRecipient(`0x${'a'.repeat(40)}`).ready, true);
});

test('Zcash connection accepts only the reviewed read-only testnet Ironwood contract', async () => {
  assert.equal((await inspectZcashReadOnlyAdapter(undefined)).code, 'NOT_DETECTED');
  assert.equal((await inspectZcashReadOnlyAdapter({ getCapabilities: async () => ({ protocol: 'other', network: 'zcash-testnet', pool: 'ironwood', readOnly: true }) })).code, 'UNSUPPORTED_ADAPTER');
  assert.equal((await inspectZcashReadOnlyAdapter({ getCapabilities: async () => ({ protocol: 'zecathon-zcash-readonly-v1', network: 'zcash-mainnet', pool: 'ironwood', readOnly: true }) })).code, 'UNSUPPORTED_NETWORK');
  assert.equal((await inspectZcashReadOnlyAdapter({ getCapabilities: async () => ({ protocol: 'zecathon-zcash-readonly-v1', network: 'zcash-testnet', pool: 'transparent', readOnly: true }) })).code, 'UNSUPPORTED_POOL');
  assert.equal((await inspectZcashReadOnlyAdapter({ getCapabilities: async () => ({ protocol: 'zecathon-zcash-readonly-v1', network: 'zcash-testnet', pool: 'ironwood', readOnly: true }) })).ready, true);
});

test('Base connection uses only read-only calls and rejects unsupported networks', async () => {
  const called: string[] = [];
  const wrongNetwork = await inspectBaseReadOnlyProvider({ request: async ({ method }) => { called.push(method); return '0x1'; } });
  assert.equal(wrongNetwork.code, 'UNSUPPORTED_NETWORK');
  assert.deepEqual(called, ['eth_chainId']);

  const readyCalls: string[] = [];
  const ready = await inspectBaseReadOnlyProvider({ request: async ({ method }) => {
    readyCalls.push(method);
    return method === 'eth_chainId' ? '0x14A34' : [`0x${'b'.repeat(40)}`];
  } });
  assert.equal(ready.ready, true);
  assert.deepEqual(readyCalls, ['eth_chainId', 'eth_accounts']);
  assert.ok(!readyCalls.some(method => /requestAccounts|sign|sendTransaction/i.test(method)));
});

test('destination signing is explicit and discards proofs after rejection, account switching, or network changes', async () => {
  const recipient=`0x${'b'.repeat(40)}`; const calls:string[]=[];
  const signature=await requestDestinationControlSignature({request:async({method})=>{
    calls.push(method); if(method==='eth_requestAccounts'||method==='eth_accounts')return [recipient]; if(method==='eth_chainId')return '0x14a34'; if(method==='eth_signTypedData_v4')return `0x${'12'.repeat(65)}`; throw new Error('unexpected');
  }},recipient,{domain:{name:'test'}});
  assert.match(signature,/^0x/); assert.deepEqual(calls,['eth_requestAccounts','eth_chainId','eth_signTypedData_v4','eth_chainId','eth_accounts']);
  await assert.rejects(requestDestinationControlSignature({request:async({method})=>{ if(method==='eth_requestAccounts')return [recipient]; if(method==='eth_chainId')return '0x14a34'; throw Object.assign(new Error('rejected'),{code:4001}); }},recipient,{}),/rejected/);
  let accountCalls=0;
  await assert.rejects(requestDestinationControlSignature({request:async({method})=>{ if(method==='eth_requestAccounts')return [recipient]; if(method==='eth_chainId')return '0x14a34'; if(method==='eth_signTypedData_v4')return '0x1234'; if(method==='eth_accounts')return [`0x${'c'.repeat(40)}`]; accountCalls+=1; return []; }},recipient,{}),/changed/);
  assert.equal(accountCalls,0);
  await assert.rejects(requestDestinationControlSignature({request:async({method})=>method==='eth_requestAccounts'?[recipient]:'0x1'},recipient,{}),/Base Sepolia/);
  await assert.rejects(requestDestinationControlSignature({request:async({method})=>{if(method==='eth_requestAccounts'||method==='eth_accounts')return[recipient];if(method==='eth_chainId')return '0x1';if(method==='eth_signTypedData_v4')return `0x${'12'.repeat(65)}`;throw new Error('unexpected');}},recipient,{}),/Base Sepolia|changed/);
});

test('multiple injected providers remain distinct so MetaMask can be selected explicitly', () => {
  const metamask = { isMetaMask: true, request: async () => [] };
  const other = { request: async () => [] };
  const events = new EventTarget() as EventTarget & { ethereum?: typeof metamask & { providers?: Array<typeof metamask | typeof other> } };
  events.ethereum = Object.assign(metamask, { providers: [other, metamask] });
  let found: Array<{ isMetaMask: boolean; provider: unknown }> = [];
  const cleanup = subscribeInjectedWalletProviders(events as Parameters<typeof subscribeInjectedWalletProviders>[0], providers => { found = providers; });
  assert.equal(found.length, 2);
  assert.equal(found.filter(item => item.isMetaMask).length, 1);
  assert.equal(found.find(item => item.isMetaMask)?.provider, metamask);
  cleanup();
});
