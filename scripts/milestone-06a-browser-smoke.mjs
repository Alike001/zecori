#!/usr/bin/env node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  async health() {}, async session(request) { const token=request.headers.cookie?.match(/zecathon_session=([0-9a-f]{64})/)?.[1]; if(token===tokenA)return {userId:'11111111-1111-4111-8111-111111111111',displayName:'Browser A',csrfToken:csrfA,passkeyCount:1,sessionToken:token,authenticatedAt:new Date().toISOString()}; if(token===tokenB)return {userId:'22222222-2222-4222-8222-222222222222',displayName:'Browser B',csrfToken:csrfB,passkeyCount:1,sessionToken:token,authenticatedAt:new Date().toISOString()}; return undefined; }, publicSession(session) { return session ? { authenticated:true,user:{id:session.userId,displayName:session.displayName,passkeyCount:session.passkeyCount},csrfToken:session.csrfToken } : { authenticated: false }; },
  async beginRegistration() { throw new Error('not available in guest smoke'); }, async finishRegistration() { throw new Error('not available in guest smoke'); },
  async beginAuthentication() { throw new Error('not available in guest smoke'); }, async finishAuthentication() { throw new Error('not available in guest smoke'); },
  async logout() {}, verifyCsrf(session, value) { return value===session.csrfToken; },
};
const speech = {
  status: { enabled:true,provider:'groq',externalRequestsApproved:true,liveValidated:false,transcription:{model:'whisper-large-v3-turbo',locales:['en','fr','ar'],providerDocumentationVerified:true},synthesis:{locales:['en','ar'],models:{en:'canopylabs/orpheus-v1-english',ar:'canopylabs/orpheus-arabic-saudi'},providerDocumentationVerified:true},limits:{maximumAudioBytes:2000000,maximumDurationMs:30000,minimumDurationMs:500,maximumSpeechCharacters:200},retention:'memory-only-until-provider-response' },
  async transcribe() { return 'Prepare 0.02 TAZ for 2 USDC'; }, async synthesize() { return new Uint8Array([82,73,70,70]); },
};

const reservation = createPortReservation();
await new Promise(resolveListen => reservation.listen(0, '127.0.0.1', resolveListen));
const reservedAddress = reservation.address();
if (!reservedAddress || typeof reservedAddress === 'string') throw new Error('Browser smoke port unavailable');
const port = reservedAddress.port;
await new Promise(resolveClose => reservation.close(resolveClose));
const origin = `http://127.0.0.1:${port}`;
const screenshotDirectory = process.env.ZECORI_SCREENSHOT_DIR ? resolve(process.env.ZECORI_SCREENSHOT_DIR) : undefined;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const server = createApplicationServer({ store: new MemoryPublicOrderRequestStore(), auth, speech, speechStatus:speech.status, routeReadiness:{operatorAttested:true,liquidityReady:true,termsValidUntil:new Date(Date.now()+60_000).toISOString()}, rateLimit:{windowMs:60_000,maximum:300}, publicOrigin: origin, staticDirectory: resolve('dist') });
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
  const capture = async (name, width, height, mobile) => {
    if (!screenshotDirectory) return;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    await writeFile(join(screenshotDirectory, name), data, 'base64');
  };

  await waitFor(`document.body?.innerText.includes('Private origin.')===true`, 'public product homepage');
  const landing = await evaluate(`({text:document.body.innerText,width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,menu:document.querySelector('.menu-toggle')!==null,brand:document.querySelector('.brand-name')?.textContent,mark:document.querySelector('.zecori-mark')?.getAttribute('aria-label')})`);
  for (const disclosure of ['one implemented testnet route','operator readiness required','0.01 taz','1 test usdc','research only','do not send funds','shielded in. transparent out.','experimental trusted lp']) if (!landing.text.toLowerCase().includes(disclosure)) throw new Error(`Landing disclosure is missing: ${disclosure}`);
  for (const productElement of ['working product preview','honest roadmap','5-minute walkthrough']) if (!landing.text.toLowerCase().includes(productElement)) throw new Error(`Landing product element is missing: ${productElement}`);
  await capture('landing-mobile.png', 390, 844, true);
  await capture('landing-desktop.png', 1440, 1100, false);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  if (!landing.menu) throw new Error('Mobile navigation control is missing');
  if (landing.brand !== 'Zecori' || !landing.mark?.includes('private-origin')) throw new Error(`Zecori wordmark or route mark is missing: ${JSON.stringify(landing)}`);
  if (landing.width > landing.viewport) throw new Error(`Landing layout overflows: ${landing.width} > ${landing.viewport}`);
  const accessibility = await evaluate(`(() => { const ids=[...document.querySelectorAll('[id]')].map(node=>node.id); const unnamed=[...document.querySelectorAll('button')].filter(node=>!(node.textContent||node.getAttribute('aria-label')||node.getAttribute('title'))); return {main:document.querySelectorAll('main').length,h1:document.querySelectorAll('h1').length,skip:Boolean(document.querySelector('.skip-link')),duplicateIds:ids.filter((id,index)=>ids.indexOf(id)!==index),unnamedButtons:unnamed.length}; })()`);
  if (accessibility.main !== 1 || accessibility.h1 !== 1 || !accessibility.skip || accessibility.duplicateIds.length || accessibility.unnamedButtons) throw new Error(`Landing accessibility semantics failed: ${JSON.stringify(accessibility)}`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
  const reducedMotion = await evaluate(`getComputedStyle(document.documentElement).scrollBehavior==='auto'`);
  if (!reducedMotion) throw new Error('Reduced-motion preference does not disable smooth scrolling');
  await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
  const themeBefore = await evaluate(`document.documentElement.dataset.theme`);
  await evaluate(`document.querySelector('.theme-toggle').click()`);
  const themeAfter = await evaluate(`({theme:document.documentElement.dataset.theme,saved:localStorage.getItem('zecori-theme')})`);
  if (themeAfter.theme === themeBefore || themeAfter.saved !== themeAfter.theme) throw new Error(`Theme preference did not toggle and persist: ${JSON.stringify({themeBefore,themeAfter})}`);

  await send('Page.navigate', { url: `${origin}/docs/getting-started` }, sessionId);
  await waitFor(`location.pathname==='/docs/getting-started' && document.querySelector('.docs-content h1')?.textContent==='Getting started'`, 'navigable documentation');
  const docs = await evaluate(`({text:document.body.innerText,current:document.querySelector('.docs-sidebar a[aria-current="page"]')?.textContent,width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth})`);
  if (docs.current?.trim() !== 'Getting started' || docs.width > docs.viewport) throw new Error(`Documentation navigation/layout failed: ${JSON.stringify(docs)}`);
  for (const claim of ['VERIFIED','EXPERIMENTAL','Only 0.01 TAZ → 1 test USDC is executable.']) if (!docs.text.includes(claim)) throw new Error(`Documentation truth marker is missing: ${claim}`);
  await capture('docs-mobile.png', 390, 844, true);
  await capture('docs-desktop.png', 1440, 1100, false);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  await send('Page.navigate', { url: `${origin}/docs/noir-wallet` }, sessionId);
  await waitFor(`document.querySelector('.docs-content h1')?.textContent==='Noir Wallet compatibility'`, 'Noir Wallet MDX documentation');
  const noirDocs = (await evaluate(`document.body.innerText`)).toLowerCase();
  for (const claim of ['first linked swap remains no-go','zcash_getaccounts','never reuse an existing profile or recovery phrase','disabled']) if (!noirDocs.includes(claim)) throw new Error(`Noir Wallet documentation marker is missing: ${claim}`);
  await send('Emulation.setLocaleOverride', { locale: 'ar-EG' }, sessionId); await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator,'language',{configurable:true,get:()=> 'ar-EG'});` }, sessionId); await send('Page.navigate', { url: `${origin}/docs/ai-and-voice` }, sessionId);
  await waitFor(`document.querySelector('.docs-page')?.getAttribute('dir')==='rtl' && document.body.innerText.includes('مراجعة بشرية')`, 'Arabic RTL documentation disclosure');
  const arabicLayout = await evaluate(`({width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,matrix:document.body.innerText.includes('Saudi Arabic · untested live')})`);
  if (arabicLayout.width > arabicLayout.viewport || !arabicLayout.matrix) throw new Error(`Arabic RTL documentation failed: ${JSON.stringify(arabicLayout)}`);
  await send('Emulation.setLocaleOverride', { locale: 'fr-FR' }, sessionId); await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator,'language',{configurable:true,get:()=> 'fr-FR'});` }, sessionId); await send('Page.reload', {}, sessionId);
  await waitFor(`document.querySelector('.docs-page')?.getAttribute('dir')==='ltr' && document.body.innerText.includes('révision humaine')`, 'French documentation disclosure');
  await send('Emulation.setLocaleOverride', { locale: 'en-US' }, sessionId); await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator,'language',{configurable:true,get:()=> 'en-US'});` }, sessionId);
  await send('Page.navigate', { url: origin }, sessionId); await waitFor(`document.body?.innerText.includes('Private origin.')===true`, 'homepage after docs');
  if (!await click('Inspect route readiness')) throw new Error('Primary route CTA is missing');
  await waitFor(`location.pathname==='/swap' && document.body?.innerText.includes('FIXED TEST ROUTE')===true`, 'public fixed-route explorer');
  const initial = await evaluate(`({text:document.body.innerText,width:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,requestDisabled:document.querySelector('.request-gate button')?.disabled})`);
  if (!initial.text.includes('Sign in only when you are ready to request.')) throw new Error('Passkey boundary is missing');
  if (!initial.text.includes('Destination is unverified until you sign')) throw new Error('Destination-control disclosure is missing');
  for (const disclosure of ['Testnet only','FIXED TEST ROUTE','Trusted testnet liquidity provider','does not hide account, wallet-provider, RPC, or trusted-LP metadata','No seed phrases, private keys, transaction signing']) if (!initial.text.includes(disclosure)) throw new Error(`Required disclosure is missing: ${disclosure}`);
  if (initial.text.includes(operatorReceiverSentinel)) throw new Error('Fixed operator receiver leaked into the browser');
  if (!initial.requestDisabled) throw new Error('Premature request action is not disabled');
  if (initial.width > initial.viewport) throw new Error(`Responsive layout overflows: ${initial.width} > ${initial.viewport}`);
  await capture('route-mobile.png', 390, 844, true);
  await capture('route-desktop.png', 1440, 1100, false);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  const productMenu = await evaluate(`({exists:document.querySelector('.product-menu-toggle')!==null,label:document.querySelector('.product-menu-toggle')?.textContent,visible:getComputedStyle(document.querySelector('.product-menu-toggle')).display!=='none'})`);
  if (!productMenu.exists || !productMenu.visible || !productMenu.label?.includes('Menu')) throw new Error(`Mobile product menu is unavailable: ${JSON.stringify(productMenu)}`);

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
  await send('Page.navigate', { url: `${origin}/history` }, sessionId);
  await waitFor(`document.querySelector('.history-row')?.textContent.includes('Track / recover')`, 'actionable private request history');
  if (!await click('Track / recover')) throw new Error('Private history tracking action is missing');
  await waitFor(`location.pathname===${JSON.stringify(`/swap/${createdA.body.request.id}`)} && document.body.innerText.includes('Waiting for operator review') && document.body.innerText.includes('Open recovery guide')`, 'request-specific tracking and recovery guidance');
  const missingHandleConfirmation = await evaluate(`fetch('/api/v1/account/handle',{method:'PUT',headers:{origin:location.origin,'content-type':'application/json','x-csrf-token':'${csrfA}'},body:JSON.stringify({candidate:'browser-a',expectedVersion:0,confirmation:''})}).then(r=>r.status)`);
  if (missingHandleConfirmation !== 400) throw new Error(`Handle claim without confirmation returned ${missingHandleConfirmation}`);
  const handleA = await evaluate(`fetch('/api/v1/account/handle',{method:'PUT',headers:{origin:location.origin,'content-type':'application/json','x-csrf-token':'${csrfA}'},body:JSON.stringify({candidate:'browser-a',expectedVersion:0,confirmation:'CLAIM @browser-a'})}).then(async r=>({status:r.status,body:await r.json()}))`);
  if (handleA.status !== 200 || handleA.body.handle?.handle !== '@browser-a') throw new Error(`Confirmed handle claim failed: ${JSON.stringify(handleA)}`);
  await evaluate(`document.cookie='zecathon_session=${tokenB}; path=/';document.cookie='zecathon_csrf=${csrfB}; path=/'`);
  const handleB = await evaluate(`fetch('/api/v1/account/handle',{method:'PUT',headers:{origin:location.origin,'content-type':'application/json','x-csrf-token':'${csrfB}'},body:JSON.stringify({candidate:'browser-b',expectedVersion:0,confirmation:'CLAIM @browser-b'})}).then(async r=>({status:r.status,body:await r.json()}))`);
  if (handleB.status !== 200) throw new Error(`Recipient handle claim failed: ${JSON.stringify(handleB)}`);
  const discoverB = await evaluate(`fetch('/api/v1/account/handle/discoverability',{method:'PATCH',headers:{origin:location.origin,'content-type':'application/json','x-csrf-token':'${csrfB}'},body:JSON.stringify({discoverable:true,expectedVersion:1,confirmation:'MAKE HANDLE DISCOVERABLE'})}).then(r=>r.status)`);
  if (discoverB !== 200) throw new Error(`Recipient discoverability opt-in failed: ${discoverB}`);
  await evaluate(`document.cookie='zecathon_session=${tokenA}; path=/';document.cookie='zecathon_csrf=${csrfA}; path=/'`);
  const contactA = await evaluate(`fetch('/api/v1/contacts',{method:'POST',headers:{origin:location.origin,'content-type':'application/json','x-csrf-token':'${csrfA}'},body:JSON.stringify({handle:'@browser-b',label:'Private recipient'})}).then(async r=>({status:r.status,body:await r.json()}))`);
  if (contactA.status !== 201 || !contactA.body.contact?.contactId) throw new Error(`Private contact creation failed: ${JSON.stringify(contactA)}`);
  const missingIntentConfirmation = await evaluate(`fetch('/api/v1/handle-requests',{method:'POST',headers:{origin:location.origin,'content-type':'application/json','x-csrf-token':'${csrfA}'},body:JSON.stringify({contactId:${JSON.stringify('${CONTACT_ID}')}})}).then(r=>r.status)`.replace('${CONTACT_ID}',contactA.body.contact.contactId));
  if (missingIntentConfirmation !== 400) throw new Error(`Route intent without confirmation returned ${missingIntentConfirmation}`);
  await send('Page.navigate', { url: `${origin}/account` }, sessionId); await waitFor(`document.body.innerText.includes('@browser-a') && document.body.innerText.includes('Private recipient')`, 'working handle and private contact surface');
  await capture('account-handles-mobile.png',390,844,true); await capture('account-handles-desktop.png',1440,1100,false);
  await send('Page.navigate', { url: `${origin}/inbox` }, sessionId); await waitFor(`document.body.innerText.includes('Events backed by the ledger.') && document.body.innerText.includes('No notifications in this view')`, 'honest empty private inbox');
  await capture('inbox-mobile.png',390,844,true); await capture('inbox-desktop.png',1440,1100,false);
  await send('Emulation.setLocaleOverride', { locale: 'ar-EG' }, sessionId); await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator,'language',{configurable:true,get:()=> 'ar-EG'});` }, sessionId); await send('Page.reload', {}, sessionId);
  await waitFor(`document.querySelector('.product-page')?.getAttribute('dir')==='rtl' && document.body.innerText.includes('أحداث موثقة في السجل')`, 'Arabic RTL inbox');
  await send('Emulation.setLocaleOverride', { locale: 'en-US' }, sessionId); await send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator,'language',{configurable:true,get:()=> 'en-US'});` }, sessionId);
  await send('Page.navigate', { url: `${origin}/assistant` }, sessionId); await waitFor(`document.querySelector('.voice-consent')!==null`, 'authenticated voice consent');
  await evaluate(`document.querySelector('.voice-consent input').click();navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError')}`);
  if (!await click('Record up to 30s')) throw new Error('Voice recording control missing');
  await waitFor(`document.body.innerText.includes('Microphone permission was refused')`, 'refused microphone fallback');
  await evaluate(`navigator.mediaDevices.getUserMedia=async()=>({getTracks:()=>[{stop(){}}]});window.MediaRecorder=class{static isTypeSupported(){return true}constructor(){this.state='inactive';this.mimeType='audio/webm'}start(){this.state='recording'}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['voice'],{type:'audio/webm'})});this.onstop?.()}}`);
  if (!await click('Record up to 30s')) throw new Error('Voice retry control missing');
  await new Promise(resolveWait=>setTimeout(resolveWait,650)); if (!await click('Stop recording')) throw new Error('Voice stop control missing');
  await waitFor(`document.body.innerText.includes('The amount does not match the only supported terms')`, 'incorrect spoken amount review');
  await evaluate(`(() => { const input=document.querySelector('.transcript-review textarea'); const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; setter.call(input,'Prepare 0.01 TAZ for 1 test USDC'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await waitFor(`[...document.querySelectorAll('button')].some(item=>item.textContent.includes('Use reviewed text')&&!item.disabled)`, 'corrected transcript acceptance'); if (!await click('Use reviewed text')) throw new Error('Corrected transcript control missing');
  const voiceReview = await evaluate(`({draft:document.querySelector('.agent-form input')?.value,submitted:[...document.querySelectorAll('.agent-prompt')].some(item=>item.textContent.includes('Prepare 0.01 TAZ'))})`);
  if (voiceReview.draft !== 'Prepare 0.01 TAZ for 1 test USDC' || voiceReview.submitted) throw new Error(`Transcript review auto-submitted or changed text: ${JSON.stringify(voiceReview)}`);
  process.stdout.write(`${JSON.stringify({ status: 'MILESTONE_09C_BROWSER_UX_SECURITY_SMOKE_PASSED', guestExploration: true, zecoriBrand:true, guidedPreview:true, honestRoadmap:true, mobileProductMenu:true, themePersistence:true, mdxDocs:true, noirWalletDocs:true, docsNavigation: true, arabicRtl: true, frenchRendering: true, accessibilitySemantics: true, reducedMotion: true, handleConfirmation:true, privateContact:true, nonPayingIntentConfirmation:true, privateInbox:true, requestHistoryRecovery:true, voiceConsent:true, microphoneRefusalFallback:true, transcriptCorrection:true, incorrectVoiceAmountBlocked:true, voiceDoesNotAutoSubmit:true, passkeyBoundary: true, walletCapabilityChecks: true, custodyAndPrivacyDisclosures: true, testnetAndFixedPriceDisclosures: true, unverifiedDestinationLabel: true, invalidRecipient: true, unsupportedNetwork: true, responsiveViewport: true, receiverWithheld: true, twoAccountIsolation: true, conflictingUpdateRejected: true, prematurePaymentRejected: true })}\n`);
} finally {
  socket?.close();
  if (chrome.exitCode === null) { chrome.kill('SIGTERM'); await new Promise(resolveExit => chrome.once('exit', resolveExit)); }
  await new Promise(resolveClose => server.close(resolveClose));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
}
