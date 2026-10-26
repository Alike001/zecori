#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const origin = process.argv.find(value => /^https?:\/\//.test(value)) ?? 'http://localhost:8787';
const profile = await mkdtemp(join(tmpdir(), 'zecathon-passkey-smoke-'));
const chrome = spawn(process.env.CHROME_BIN ?? 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let browserSocket;
try {
  browserSocket = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Chrome DevTools endpoint timed out')), 15_000);
    chrome.stderr.on('data', chunk => {
      output += chunk.toString(); const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    chrome.once('exit', code => reject(new Error(`Chrome exited before startup (${code})`)));
  });

  const socket = new WebSocket(browserSocket); let nextId = 0; const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return; const callback = pending.get(message.id); if (!callback) return;
    pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('WebAuthn.enable', {}, sessionId);
  const authenticatorOptions = { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };
  const { authenticatorId: firstAuthenticatorId } = await send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions }, sessionId);
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId);
  await send('Page.navigate', { url: new URL('/swap', origin).href }, sessionId);

  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Browser evaluation failed');
    return result.result.value;
  };
  const waitFor = async (expression, description) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const value = await evaluate(expression); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100));
    }
    const state = await evaluate(`({ href: location.href, ready: document.readyState, body: document.body?.innerText?.slice(0,500) })`);
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(state)}`);
  };
  const click = text => evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(item=>item.textContent.includes(${JSON.stringify(text)})); if(!button)return false; button.click(); return true; })()`);

  await waitFor(`document.querySelector('input[placeholder="Private account label"]') !== null`, 'identity form');
  await evaluate(`(() => { const input=document.querySelector('input[placeholder="Private account label"]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'TEST-ONLY browser account'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor(`[...document.querySelectorAll('button')].some(item=>item.textContent.includes('Create with passkey')&&!item.disabled)`, 'enabled passkey registration');
  if (!await click('Create with passkey')) throw new Error('Registration button was unavailable');
  const registration = await waitFor(`fetch('/api/v1/session').then(r=>r.json()).then(v=>v.authenticated===true?'authenticated':(document.querySelector('[role="alert"]')?.textContent||''))`, 'passkey registration');
  if (registration !== 'authenticated') throw new Error(`Passkey registration failed in browser: ${registration}`);
  await send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: firstAuthenticatorId }, sessionId);
  await send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions }, sessionId);
  if (!await click('Add passkey')) throw new Error('Add passkey button was unavailable');
  const added = await waitFor(`fetch('/api/v1/session').then(r=>r.json()).then(v=>v.user?.passkeyCount===2?'added':(document.querySelector('[role="alert"]')?.textContent||''))`, 'second passkey');
  if (added !== 'added') throw new Error(`Second passkey registration failed in browser: ${added}`);
  await waitFor(`fetch('/api/v1/capabilities').then(r=>r.json()).then(v=>v.orderCreation?.enabled===true&&v.orderCreation?.walletControlVerification==='required-eip712-eoa'&&v.wallets?.base?.contractWallets==='disabled-until-live-validation')`, 'EOA-only wallet-control order capability');
  const unverified = await evaluate(`fetch('/api/v1/session').then(r=>r.json()).then(s=>fetch('/api/v1/order-requests',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':s.csrfToken},body:JSON.stringify({routeId:'zcash-testnet-to-base-sepolia-fixed',amountZatoshis:'1000000',termsAccepted:true,source:{mode:'external',network:'zcash-testnet',pool:'ironwood'},destination:{mode:'manual',network:'base-sepolia',chainId:84532,contract:'0x036CbD53842c5426634e7929541eC2318f3dCF7e',address:'0x1111111111111111111111111111111111111111'},destinationConsent:{version:'base-destination-intent-v1',statement:'I confirm this exact Base Sepolia address is the intended USDC recipient. This records my intent and does not prove that I control the wallet.',confirmed:true}})})).then(async r=>({status:r.status,body:await r.json()}))`);
  if (unverified.status !== 202 || unverified.body.request?.destinationBinding?.walletControlVerification !== 'unverified' || unverified.body.request?.paymentInstructions) throw new Error('Unverified destination was not safely blocked from financial instructions');
  if (!await click('Sign out')) throw new Error('Sign-out button was unavailable');
  await waitFor(`fetch('/api/v1/session').then(r=>r.json()).then(v=>v.authenticated===false)`, 'logout revocation');
  if (!await click('Sign in with passkey')) throw new Error('Login button was unavailable');
  await waitFor(`fetch('/api/v1/session').then(r=>r.json()).then(v=>v.authenticated===true)`, 'passkey login');
  const historyReadable = await evaluate(`fetch('/api/v1/order-requests').then(r=>r.status===200)`);
  if (!historyReadable) throw new Error('Authenticated private history was unavailable after login');
  process.stdout.write(`${JSON.stringify({ status: 'PASSKEY_BROWSER_SMOKE_PASSED', registeredPasskeys: 2, sessionRevoked: true, crossSessionHistory: true, unverifiedDestinationBlocked: true })}\n`);
  socket.close();
} finally {
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await new Promise(resolve => chrome.once('exit', resolve)); }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
}
