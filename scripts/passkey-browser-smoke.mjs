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
  await send('Page.navigate', { url: origin }, sessionId);

  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Browser evaluation failed');
    return result.result.value;
  };
  const waitFor = async (expression, description) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100));
    }
    const state = await evaluate(`({ href: location.href, ready: document.readyState, body: document.body?.innerText?.slice(0,500) })`);
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(state)}`);
  };
  const click = text => evaluate(`(() => { const button=[...document.querySelectorAll('button')].find(item=>item.textContent.includes(${JSON.stringify(text)})); if(!button)return false; button.click(); return true; })()`);

  await waitFor(`document.querySelector('input[placeholder="Private account label"]') !== null`, 'identity form');
  await evaluate(`(() => { const input=document.querySelector('input[placeholder="Private account label"]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'TEST-ONLY browser account'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  if (!await click('Create with passkey')) throw new Error('Registration button was unavailable');
  await waitFor(`fetch('/api/v1/session').then(r=>r.json()).then(v=>v.authenticated===true)`, 'passkey registration');
  await send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: firstAuthenticatorId }, sessionId);
  await send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions }, sessionId);
  if (!await click('Add passkey')) throw new Error('Add passkey button was unavailable');
  await waitFor(`fetch('/api/v1/session').then(r=>r.json()).then(v=>v.user?.passkeyCount===2)`, 'second passkey');
  if (!await click('Request operator review')) throw new Error('Order request button was unavailable');
  await waitFor(`fetch('/api/v1/order-requests').then(r=>r.json()).then(v=>v.requests?.length===1)`, 'first account order');
  const orderId = await evaluate(`fetch('/api/v1/order-requests').then(r=>r.json()).then(v=>v.requests[0].id)`);
  if (!await click('Logout')) throw new Error('Logout button was unavailable');
  await waitFor(`fetch('/api/v1/session').then(r=>r.json()).then(v=>v.authenticated===false)`, 'logout revocation');
  if (!await click('Sign in with passkey')) throw new Error('Login button was unavailable');
  await waitFor(`fetch('/api/v1/session').then(r=>r.json()).then(v=>v.authenticated===true)`, 'passkey login');
  const recoveredOrder = await evaluate(`fetch('/api/v1/order-requests').then(r=>r.json()).then(v=>v.requests?.[0]?.id)`);
  if (recoveredOrder !== orderId) throw new Error('Cross-session history did not recover the same order');
  process.stdout.write(`${JSON.stringify({ status: 'PASSKEY_BROWSER_SMOKE_PASSED', registeredPasskeys: 2, sessionRevoked: true, crossSessionHistory: true })}\n`);
  socket.close();
} finally {
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await new Promise(resolve => chrome.once('exit', resolve)); }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
}
