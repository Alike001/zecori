#!/usr/bin/env node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const extensionDirectory = process.env.NOIR_TESTNET_EXTENSION_DIR;
if (!extensionDirectory) throw new Error('Set NOIR_TESTNET_EXTENSION_DIR to a reviewed, checksum-verified, unpacked official testnet extension.');
const extensionPath = resolve(extensionDirectory);
const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
if (!/testnet/i.test(String(manifest.name))) throw new Error('Refusing extension whose manifest name does not explicitly say Testnet.');
if (!/^1\.0\.40(?:\.|$)/.test(String(manifest.version))) throw new Error(`Expected Noir Wallet 1.0.40 testnet, received ${manifest.version}.`);
const origin = process.argv.find(value => /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(value));
if (!origin) throw new Error('Pass an explicit loopback Zecori URL. Non-loopback origins are refused.');

const profile = await mkdtemp(join(tmpdir(), 'zecori-noir-testnet-'));
const chrome = spawn(process.env.CHROME_BIN ?? 'google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, origin,
], { stdio: ['ignore', 'ignore', 'pipe'] });

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
  const targets = await send('Target.getTargets');
  const target = targets.targetInfos.find(item => item.type === 'page');
  if (!target) throw new Error('No browser page target is available.');
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  let result;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const evaluated = await send('Runtime.evaluate', { expression: `window.noirwallet?.isNoirWallet && window.noirwallet?.zcash?.request ? 'ready' : ''`, returnByValue: true }, sessionId);
    if (evaluated.result.value === 'ready') { result = evaluated; break; }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  if (!result) throw new Error('Noir Wallet provider was not detected in the isolated profile.');
  const probe = await send('Runtime.evaluate', { expression: `window.noirwallet.zcash.request({method:'zcash_getAccounts'}).then(value=>({ok:true,connected:value!==null})).catch(error=>({ok:false,error:String(error?.message||error)}))`, awaitPromise: true, returnByValue: true }, sessionId);
  if (!probe.result.value?.ok) throw new Error(`Silent Noir probe failed: ${probe.result.value?.error}`);
  process.stdout.write(`${JSON.stringify({ status: 'NOIR_TESTNET_READONLY_SMOKE_PASSED', version: manifest.version, isolatedProfile: true, requestedMethods: ['zcash_getAccounts'], existingAuthorization: probe.result.value.connected })}\n`);
} finally {
  socket?.close();
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await new Promise(resolveExit => chrome.once('exit', resolveExit)); }
  await rm(profile, { recursive: true, force: true });
}
