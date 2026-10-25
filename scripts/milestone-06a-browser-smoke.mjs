#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as createPortReservation } from 'node:net';
import { createApplicationServer } from '../server/app-server.ts';
import { MemoryPublicOrderRequestStore } from '../server/public-order-store.ts';

const operatorReceiverSentinel = `0x${'9'.repeat(40)}`;
const tokenA = 'a'.repeat(64); const tokenB = 'b'.repeat(64); const csrfA = 'c'.repeat(64); const csrfB = 'd'.repeat(64);
const auth = {
  config: { rpName: 'Browser smoke', rpId: '127.0.0.1', expectedOrigin: 'http://127.0.0.1', secureCookies: false },
  async health() {}, async session(request) { const token=request.headers.cookie?.match(/zecathon_session=([0-9a-f]{64})/)?.[1]; if(token===tokenA)return {userId:'11111111-1111-4111-8111-111111111111',displayName:'Browser A',csrfToken:csrfA,passkeyCount:1,sessionToken:token}; if(token===tokenB)return {userId:'22222222-2222-4222-8222-222222222222',displayName:'Browser B',csrfToken:csrfB,passkeyCount:1,sessionToken:token}; return undefined; }, publicSession(session) { return session ? { authenticated:true,user:{id:session.userId,displayName:session.displayName,passkeyCount:session.passkeyCount},csrfToken:session.csrfToken } : { authenticated: false }; },
  async beginRegistration() { throw new Error('not available in guest smoke'); }, async finishRegistration() { throw new Error('not available in guest smoke'); },
  async beginAuthentication() { throw new Error('not available in guest smoke'); }, async finishAuthentication() { throw new Error('not available in guest smoke'); },
  async logout() {}, verifyCsrf(session, value) { return value===session.csrfToken; },
};

const reservation = createPortReservation();
await new Promise(resolveListen => reservation.listen(0, '127.0.0.1', resolveListen));
const reservedAddress = reservation.address();
if (!reservedAddress || typeof reservedAddress === 'string') throw new Error('Browser smoke port unavailable');
const port = reservedAddress.port;
await new Promise(resolveClose => reservation.close(resolveClose));
const origin = `http://127.0.0.1:${port}`;
const server = createApplicationServer({ store: new MemoryPublicOrderRequestStore(), auth, publicOrigin: origin, staticDirectory: resolve('dist') });
await new Promise(resolveListen => server.listen(port, '127.0.0.1', resolveListen));
const profile = await mkdtemp(join(tmpdir(), 'zecathon-06a-browser-'));
const chrome = spawn(process.env.CHROME_BIN ?? 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });

let socket;
try {
  const browserSocket = await new Promise((resolveSocket, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('Chrome DevTools endpoint timed out')), 15_000);
    chrome.stderr.on('data', chunk => { output += chunk.toString(); const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolveSocket(match[1]); } });
    chrome.once('exit', code => reject(new Error(`Chrome exited before startup (${code})`)));
  });
  socket = new WebSocket(browserSocket); let nextId = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(String(event.data)); if (!message.id) return; const callback = pending.get(message.id); if (!callback) return; pending.delete(message.id); message.error ? callback.reject(new Error(message.error.message)) : callback.resolve(message.result); });
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const send = (method, params = {}, sessionId) => new Promise((resolveSend, reject) => { const id = ++nextId; pending.set(id, { resolve: resolveSend, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId); await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.zecathonZcashReadOnly={getCapabilities:async()=>({protocol:'zecathon-zcash-readonly-v1',network:'zcash-testnet',pool:'ironwood',readOnly:true})};window.ethereum={request:async({method})=>method==='eth_chainId'?'0x1':[]};` }, sessionId);
  await send('Page.navigate', { url: origin }, sessionId);
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Browser evaluation failed'); return result.result.value; };
  const waitFor = async (expression, description) => { for (let attempt = 0; attempt < 100; attempt += 1) { if (await evaluate(expression)) return; await new Promise(resolveWait => setTimeout(resolveWait, 100)); } const state = await evaluate(`({href:location.href,ready:document.readyState,text:document.body?.innerText?.slice(0,800),html:document.documentElement?.outerHTML?.slice(0,500)})`); throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(state)}`); };
  const click = text => evaluate(`(() => { const item=[...document.querySelectorAll('button')].find(node=>node.textContent.includes(${JSON.stringify(text)})); if(!item)return false; item.click(); return true; })()`);

  await waitFor(`document.body?.innerText.includes('FIXED TEST ROUTE')===true`, 'public fixed-route explorer');
  const initial = await evaluate(`({text:document.body.innerText,width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,requestDisabled:document.querySelector('.request-gate button')?.disabled})`);
  if (!initial.text.includes('Sign in only when you are ready to request.')) throw new Error('Passkey boundary is missing');
  if (!initial.text.includes('Destination is unverified until you sign')) throw new Error('Destination-control disclosure is missing');
  for (const disclosure of ['Testnet only','FIXED TEST ROUTE','Trusted testnet liquidity provider','does not hide account, wallet-provider, RPC, or trusted-LP metadata','No seed phrases, private keys, transaction signing']) if (!initial.text.includes(disclosure)) throw new Error(`Required disclosure is missing: ${disclosure}`);
  if (initial.text.includes(operatorReceiverSentinel)) throw new Error('Fixed operator receiver leaked into the browser');
  if (!initial.requestDisabled) throw new Error('Premature request action is not disabled');
  if (initial.width > initial.viewport) throw new Error(`Responsive layout overflows: ${initial.width} > ${initial.viewport}`);

  if (!await click('Check browser wallet')) throw new Error('Zcash wallet option missing');
  await waitFor(`document.body.innerText.includes('Zcash testnet and Ironwood read-only capabilities verified.')`, 'Zcash capability success');
  if (!await click('Check connected Base wallet')) throw new Error('Base wallet option missing');
  await waitFor(`document.body.innerText.includes('Switch the wallet to Base Sepolia')`, 'unsupported Base network rejection');
  if (!await click('Provide a receiving address')) throw new Error('Manual receiving-address option missing');
  await evaluate(`(() => { const input=document.querySelector('input[placeholder="0x…"]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'0x1234'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor(`document.body.innerText.includes('valid mixed-case EIP-55 checksum')`, 'invalid recipient rejection');
  const guestRequestStatus = await evaluate(`fetch('/api/v1/order-requests',{method:'POST',headers:{origin:location.origin,'content-type':'application/json'},body:'{}'}).then(response=>response.status)`);
  if (guestRequestStatus !== 401) throw new Error(`Guest request boundary returned ${guestRequestStatus}`);
  const consent = 'I confirm this exact Base Sepolia address is the intended USDC recipient. This records my intent and does not prove that I control the wallet.';
  const intent = address => ({routeId:'zcash-testnet-to-base-sepolia-fixed',amountZatoshis:'1000000',termsAccepted:true,source:{mode:'external',network:'zcash-testnet',pool:'ironwood'},destination:{mode:'manual',network:'base-sepolia',chainId:84532,contract:'0x036CbD53842c5426634e7929541eC2318f3dCF7e',address},destinationConsent:{version:'base-destination-intent-v1',statement:consent,confirmed:true}});
  await evaluate(`document.cookie='zecathon_session=${tokenA}; path=/';document.cookie='zecathon_csrf=${csrfA}; path=/'`);
  const createdA = await evaluate(`fetch('/api/v1/order-requests',{method:'POST',headers:{origin:location.origin,'content-type':'application/json','x-csrf-token':'${csrfA}'},body:${JSON.stringify(JSON.stringify(intent(`0x${'1'.repeat(40)}`)))}}).then(async r=>({status:r.status,body:await r.json()}))`);
  if (createdA.status !== 202 || createdA.body.request.paymentInstructions || createdA.body.request.destinationRecipient) throw new Error('Account A destination intent was not safely created');
  await evaluate(`document.cookie='zecathon_session=${tokenB}; path=/';document.cookie='zecathon_csrf=${csrfB}; path=/'`);
  const createdB = await evaluate(`fetch('/api/v1/order-requests',{method:'POST',headers:{origin:location.origin,'content-type':'application/json','x-csrf-token':'${csrfB}'},body:${JSON.stringify(JSON.stringify(intent(`0x${'2'.repeat(40)}`)))}}).then(async r=>({status:r.status,body:await r.json()}))`);
  if (createdB.status !== 202 || createdA.body.request.id === createdB.body.request.id) throw new Error('Two-account destination isolation failed');
  const crossAccount = await evaluate(`fetch('/api/v1/order-requests/'+${JSON.stringify(createdA.body.request.id)}).then(r=>r.status)`);
  if (crossAccount !== 404) throw new Error(`Cross-account request read returned ${crossAccount}`);
  await evaluate(`document.cookie='zecathon_session=${tokenA}; path=/';document.cookie='zecathon_csrf=${csrfA}; path=/'`);
  const conflict = await evaluate(`fetch('/api/v1/order-requests',{method:'POST',headers:{origin:location.origin,'content-type':'application/json','x-csrf-token':'${csrfA}'},body:${JSON.stringify(JSON.stringify(intent(`0x${'2'.repeat(40)}`)))}}).then(r=>r.status)`);
  if (conflict !== 409) throw new Error(`Conflicting destination update returned ${conflict}`);
  const premature = await evaluate(`fetch('/api/v1/orders/'+${JSON.stringify(createdA.body.request.id)}+'/publish-instructions',{method:'POST',headers:{origin:location.origin,'content-type':'application/json','x-csrf-token':'${csrfA}'},body:'{}'}).then(r=>r.status)`);
  if (premature !== 404) throw new Error(`Premature payment action returned ${premature}`);
  process.stdout.write(`${JSON.stringify({ status: 'MILESTONE_06D_BROWSER_SMOKE_PASSED', guestExploration: true, passkeyBoundary: true, walletCapabilityChecks: true, custodyAndPrivacyDisclosures: true, testnetAndFixedPriceDisclosures: true, unverifiedDestinationLabel: true, invalidRecipient: true, unsupportedNetwork: true, responsiveViewport: true, receiverWithheld: true, twoAccountIsolation: true, conflictingUpdateRejected: true, prematurePaymentRejected: true })}\n`);
} finally {
  socket?.close();
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await new Promise(resolveExit => chrome.once('exit', resolveExit)); }
  await new Promise(resolveClose => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
}
