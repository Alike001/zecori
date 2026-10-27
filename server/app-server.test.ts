import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplicationServer } from './app-server.ts';
import { MemoryPublicOrderRequestStore } from './public-order-store.ts';
import type { AuthenticatedUser, UserIdentityService } from './user-auth.ts';
import { fixedWalletReadinessIntent } from './wallet-intent.ts';
import type { PrivyIdentityService } from './privy-auth.ts';
import { SPEECH_LIMITS, type SpeechProvider } from './speech-provider.ts';

const recipient = `0x${'3'.repeat(40)}`;
const tokenA = 'a'.repeat(64); const tokenB = 'b'.repeat(64); const csrfA = 'c'.repeat(64); const csrfB = 'd'.repeat(64);

class TestIdentity implements UserIdentityService {
  readonly config = { rpName: 'Test', rpId: '127.0.0.1', expectedOrigin: 'http://127.0.0.1:8787', secureCookies: false };
  revoked = new Set<string>();
  async health() {}
  async session(request: Parameters<UserIdentityService['session']>[0]): Promise<AuthenticatedUser | undefined> {
    const token = request.headers.cookie?.match(/zecathon_session=([0-9a-f]{64})/)?.[1];
    if (!token || this.revoked.has(token)) return undefined;
    if (token === tokenA) return { userId: '11111111-1111-4111-8111-111111111111', displayName: 'User A', csrfToken: csrfA, passkeyCount: 2, sessionToken: token, authenticatedAt: new Date().toISOString() };
    if (token === tokenB) return { userId: '22222222-2222-4222-8222-222222222222', displayName: 'User B', csrfToken: csrfB, passkeyCount: 1, sessionToken: token, authenticatedAt: new Date().toISOString() };
    return undefined;
  }
  publicSession(session?: AuthenticatedUser) { return session ? { authenticated: true, user: { id: session.userId, displayName: session.displayName, passkeyCount: session.passkeyCount }, csrfToken: session.csrfToken } : { authenticated: false }; }
  async beginRegistration(): Promise<never> { throw new Error('not implemented in HTTP fixture'); }
  async finishRegistration(): Promise<never> { throw new Error('not implemented in HTTP fixture'); }
  async beginAuthentication(): Promise<never> { throw new Error('not implemented in HTTP fixture'); }
  async finishAuthentication(): Promise<never> { throw new Error('not implemented in HTTP fixture'); }
  async logout(session: AuthenticatedUser) { this.revoked.add(session.sessionToken); }
  verifyCsrf(session: AuthenticatedUser, provided: string | string[] | undefined) { return provided === session.csrfToken; }
}

async function fixture(t: TestContext, maximum = 20, agentMaximum = 10, privy?: PrivyIdentityService, speech?: SpeechProvider, routeState: boolean | { operatorAttested: boolean; liquidityReady: boolean; termsValidUntil?: string } = true, requireProxyHttps = false) {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-server-'));
  await mkdir(join(folder, 'assets'));
  await writeFile(join(folder, 'index.html'), '<!doctype html><main>zecathon-production</main>');
  await writeFile(join(folder, 'assets', 'app.js'), 'globalThis.loaded=true');
  const store = new MemoryPublicOrderRequestStore();
  const server = createApplicationServer({
    store, auth: new TestIdentity(), publicOrigin: 'http://127.0.0.1:8787',
    routeReadiness: typeof routeState === 'boolean' ? (routeState ? { operatorAttested: true, liquidityReady: true, termsValidUntil: new Date(Date.now() + 60_000).toISOString() } : { operatorAttested: false, liquidityReady: false }) : routeState,
    staticDirectory: folder, rateLimit: { windowMs: 60_000, maximum }, agentRateLimit: { windowMs: 60_000, maximum: agentMaximum },
    requireProxyHttps,
    ...(privy ? { privy, privyAppId: 'public-test-app-id' } : {}), ...(speech ? { speech, speechStatus: speech.status } : {}),
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server address unavailable');
  return { base: `http://127.0.0.1:${address.port}`, cookieA: `zecathon_session=${tokenA}; zecathon_csrf=${csrfA}`, cookieB: `zecathon_session=${tokenB}; zecathon_csrf=${csrfB}`, store };
}

test('standalone server provides health checks, static assets, and SPA deep links', async t => {
  const { base } = await fixture(t);
  const live = await fetch(`${base}/health/live`); assert.equal(live.status, 200); assert.match(live.headers.get('permissions-policy') ?? '', /microphone=\(self\)/);
  assert.equal((await fetch(`${base}/health/ready`)).status, 200);
  assert.match(await (await fetch(`${base}/history/example`)).text(), /zecathon-production/);
  assert.match(await (await fetch(`${base}/assets/app.js`)).text(), /loaded/);
  assert.equal((await fetch(`${base}/api/orders`)).status, 404);
});

test('production proxy mode emits HSTS and rejects non-HTTPS forwarding', async t => {
  const { base } = await fixture(t, 20, 10, undefined, undefined, true, true);
  const secure = await fetch(`${base}/health/live`, { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(secure.status, 200);
  assert.equal(secure.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  const insecure = await fetch(`${base}/api/v1/capabilities`, { headers: { 'x-forwarded-proto': 'http' } });
  assert.equal(insecure.status, 400);
  assert.match(await insecure.text(), /HTTPS_REQUIRED/);
});

const walletIntent = fixedWalletReadinessIntent(`0x${'4'.repeat(40)}`);

test('guest exploration stays public while private order creation requires a passkey session', async t => {
  const { base, cookieA, cookieB } = await fixture(t);
  const capabilitiesResponse = await fetch(`${base}/api/v1/capabilities`);
  assert.equal(capabilitiesResponse.status, 200);
  const capabilitiesText = await capabilitiesResponse.text();
  assert.match(capabilitiesText, /fixed-test-terms/);
  assert.match(capabilitiesText, /encrypted-owner-scoped-v2/);
  assert.ok(!capabilitiesText.includes(recipient), 'the fixed operator receiver must not be public');
  assert.equal((await fetch(`${base}/api/v1/order-requests`)).status, 401);
  const guestCreate = await fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers: { origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' }, body: JSON.stringify(walletIntent) });
  assert.equal(guestCreate.status, 401);

  const sessionResponse = await fetch(`${base}/api/v1/session`, { headers: { cookie: cookieA } });
  const { csrfToken } = await sessionResponse.json() as { csrfToken: string };
  const denied = await fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers: { cookie: cookieA, origin: 'https://attacker.invalid', 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(walletIntent) });
  assert.equal(denied.status, 403);
  const noCsrf = await fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers: { cookie: cookieA, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' }, body: JSON.stringify(walletIntent) });
  assert.equal(noCsrf.status, 403);
  assert.equal((await fetch(`${base}/api/v1/order-requests`, { headers: { cookie: cookieB } })).status, 200);
  for (const action of ['approve-payout', 'derive-address', 'broadcast', 'wallet-rpc']) {
    assert.equal((await fetch(`${base}/api/v1/orders/example/${action}`, { method: 'POST', headers: { cookie: cookieA, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' })).status, 404);
  }
});

test('route request creation fails closed without a current operator readiness attestation', async t => {
  const { base, cookieA } = await fixture(t, 20, 10, undefined, undefined, false);
  const capabilities = await (await fetch(`${base}/api/v1/capabilities`)).json() as { orderCreation: { enabled: boolean; state: string }; routes: Array<{ id: string; availability: string; execution: { enabled: boolean } }> };
  assert.deepEqual(capabilities.orderCreation, {
    enabled: false,
    state: 'operator-review-required',
    reason: 'Current operator readiness has not been attested.',
    readiness: { enabled: false, operator: 'required', liquidity: 'missing', terms: 'unconfigured', reason: 'Current operator readiness has not been attested.' },
    binding: 'encrypted-owner-scoped-v2',
    walletControlVerification: 'required-eip712-eoa',
  });
  const route = capabilities.routes.find(item => item.id === 'zcash-testnet-to-base-sepolia-fixed');
  assert.equal(route?.availability, 'operator-review-required');
  assert.equal(route?.execution.enabled, false);
  const response = await fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers: { cookie: cookieA, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfA }, body: JSON.stringify(walletIntent) });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /ROUTE_OPERATOR_REVIEW_REQUIRED/);
});

test('route creation rejects missing liquidity and stale fixed terms even after operator attestation', async t => {
  for (const [routeState, expectedReason] of [
    [{ operatorAttested: true, liquidityReady: false, termsValidUntil: new Date(Date.now() + 60_000).toISOString() }, /liquidity/i],
    [{ operatorAttested: true, liquidityReady: true, termsValidUntil: new Date(Date.now() - 1_000).toISOString() }, /expired/i],
  ] as const) {
    const { base, cookieA } = await fixture(t, 20, 10, undefined, undefined, routeState);
    const capabilities = await (await fetch(`${base}/api/v1/capabilities`)).json() as { orderCreation: { enabled: boolean; reason: string } };
    assert.equal(capabilities.orderCreation.enabled, false); assert.match(capabilities.orderCreation.reason, expectedReason);
    const response = await fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers: { cookie: cookieA, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfA }, body: JSON.stringify(walletIntent) });
    assert.equal(response.status, 503); assert.match(await response.text(), expectedReason);
  }
});

test('handle, contact, request-intent and inbox APIs require account ownership, origin and CSRF', async t => {
  const {base,cookieA,cookieB}=await fixture(t,60);
  const headersA={cookie:cookieA,origin:'http://127.0.0.1:8787','content-type':'application/json','x-csrf-token':csrfA};
  const headersB={cookie:cookieB,origin:'http://127.0.0.1:8787','content-type':'application/json','x-csrf-token':csrfB};
  assert.equal((await fetch(`${base}/api/v1/account/handle`)).status,401);
  assert.equal((await fetch(`${base}/api/v1/account/handle`,{method:'PUT',headers:{...headersA,'x-csrf-token':''},body:'{}'})).status,403);
  const claimA=await fetch(`${base}/api/v1/account/handle`,{method:'PUT',headers:headersA,body:JSON.stringify({candidate:'owner-alpha',expectedVersion:0,confirmation:'CLAIM @owner-alpha'})});assert.equal(claimA.status,200);
  const claimB=await fetch(`${base}/api/v1/account/handle`,{method:'PUT',headers:headersB,body:JSON.stringify({candidate:'owner-beta',expectedVersion:0,confirmation:'CLAIM @owner-beta'})});assert.equal(claimB.status,200);
  const handleA=(await claimA.json() as {handle:{version:number}}).handle;
  assert.equal((await fetch(`${base}/api/v1/account/handle/discoverability`,{method:'PATCH',headers:headersA,body:JSON.stringify({discoverable:true,expectedVersion:handleA.version,confirmation:'MAKE HANDLE DISCOVERABLE'})})).status,200);
  const contact=await fetch(`${base}/api/v1/contacts`,{method:'POST',headers:headersB,body:JSON.stringify({handle:'owner-alpha',label:'TEST-ONLY Alpha'})});assert.equal(contact.status,201);const contactId=(await contact.json() as {contact:{contactId:string}}).contact.contactId;
  assert.equal((await fetch(`${base}/api/v1/contacts`,{headers:{cookie:cookieA}}).then(response=>response.json()) as {contacts:unknown[]}).contacts.length,0,'contact graph is owner isolated');
  const intent=await fetch(`${base}/api/v1/handle-requests`,{method:'POST',headers:headersB,body:JSON.stringify({contactId,confirmation:'REQUEST FIXED TEST ROUTE'})});assert.equal(intent.status,201);const intentId=(await intent.json() as {request:{intentId:string}}).request.intentId;
  assert.equal((await fetch(`${base}/api/v1/handle-requests/${intentId}/respond`,{method:'POST',headers:headersB,body:JSON.stringify({action:'ACCEPT',confirmation:'ACCEPT REQUEST — NO PAYMENT'})})).status,404);
  assert.equal((await fetch(`${base}/api/v1/handle-requests/${intentId}/respond`,{method:'POST',headers:headersA,body:JSON.stringify({action:'ACCEPT',confirmation:'ACCEPT REQUEST — NO PAYMENT'})})).status,200);
  assert.equal((await fetch(`${base}/api/v1/inbox`)).status,401);
});

test('Privy stays disabled by default and enabled login/link preserve origin, CSRF, and explicit-link boundaries', async t => {
  const disabled = await fixture(t);
  const disabledCapabilities = await (await fetch(`${disabled.base}/api/v1/capabilities`)).json() as { authentication: { privy: { enabled: boolean } }; routes: Array<{ availability: string; execution: { enabled: boolean } }>; productCapabilities: Array<{ id: string; status: string; summary: string }> };
  assert.equal(disabledCapabilities.authentication.privy.enabled, false);
  assert.equal(disabledCapabilities.routes.filter(route => route.execution.enabled).length, 1);
  assert.ok(disabledCapabilities.routes.every(route => ['verified-executable','operator-review-required','experimental-disabled','research-only'].includes(route.availability)));
  assert.equal(disabledCapabilities.productCapabilities.find(item => item.id === 'privy-auth')?.status, 'DISABLED');
  assert.equal(disabledCapabilities.productCapabilities.find(item => item.id === 'live-quotes')?.status, 'DISABLED');
  assert.equal(disabledCapabilities.productCapabilities.find(item => item.id === 'inbox')?.status, 'EXPERIMENTAL');
  assert.ok(disabledCapabilities.productCapabilities.filter(item => ['DISABLED','PLANNED'].includes(item.status)).every(item => !/available now|shipped/i.test(item.summary)));

  const calls: string[] = [];
  const privy: PrivyIdentityService = {
    enabled: true,
    async login(token, current) {
      calls.push(`login:${token}:${current?.userId ?? 'guest'}`);
      if (current) throw Object.assign(new Error('explicit linking required'), { statusCode: 409, code: 'EXPLICIT_LINK_REQUIRED' });
      return { session: { sessionToken: 'e'.repeat(64), csrfToken: 'f'.repeat(64), maxAge: 60 }, userId: randomUUID(), created: false };
    },
    async link(token, current) { calls.push(`link:${token}:${current.userId}`); return { linked: true, alreadyLinked: false }; },
  };
  const { base, cookieA } = await fixture(t, 20, 10, privy);
  const capabilities = await (await fetch(`${base}/api/v1/capabilities`)).json() as { authentication: { privy: Record<string, unknown> } };
  assert.deepEqual(capabilities.authentication.privy, { enabled: true, appId: 'public-test-app-id', loginMethods: ['email','google'], embeddedWalletCreation: false, delegatedActions: false, serverSigning: false });

  const headers = { origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', authorization: 'Bearer token-a' };
  const login = await fetch(`${base}/api/v1/auth/privy/login`, { method: 'POST', headers, body: '{}' });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie') ?? '', /zecathon_session=/);
  assert.ok(!(await login.text()).includes('token-a'));
  assert.equal((await fetch(`${base}/api/v1/auth/privy/login`, { method: 'POST', headers: { ...headers, cookie: cookieA }, body: '{}' })).status, 409);
  assert.equal((await fetch(`${base}/api/v1/auth/privy/link`, { method: 'POST', headers: { ...headers, cookie: cookieA }, body: '{}' })).status, 403);
  const linked = await fetch(`${base}/api/v1/auth/privy/link`, { method: 'POST', headers: { ...headers, cookie: cookieA, 'x-csrf-token': csrfA }, body: '{}' });
  assert.equal(linked.status, 200);
  assert.deepEqual(calls, ['login:token-a:guest', 'login:token-a:11111111-1111-4111-8111-111111111111', 'link:token-a:11111111-1111-4111-8111-111111111111']);
});

test('wallet intent rejects invalid recipients, unsupported networks, and premature payment attempts', async t => {
  const { base, cookieA, store } = await fixture(t);
  const headers = { cookie: cookieA, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfA };
  const submit = (body: unknown) => fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers, body: JSON.stringify(body) });

  const invalidRecipient = await submit({ ...walletIntent, destination: { ...walletIntent.destination, address: '0x1234' } });
  assert.equal(invalidRecipient.status, 400); assert.match(await invalidRecipient.text(), /INVALID_DESTINATION_RECIPIENT/);
  const transparent = await submit({ ...walletIntent, source: { ...walletIntent.source, pool: 'transparent' } });
  assert.equal(transparent.status, 400); assert.match(await transparent.text(), /UNSUPPORTED_SOURCE_POOL/);
  const mainnet = await submit({ ...walletIntent, destination: { ...walletIntent.destination, network: 'base-mainnet', chainId: 8453 } });
  assert.equal(mainnet.status, 400); assert.match(await mainnet.text(), /DESTINATION_DISABLED/);
  const created = await submit(walletIntent);
  assert.equal(created.status, 202); const body = await created.json() as { request: { id: string; paymentInstructions?: unknown; destinationRecipient?: unknown; destinationBinding: { walletControlVerification: string } } };
  assert.equal(body.request.paymentInstructions, undefined); assert.equal(body.request.destinationRecipient, undefined); assert.equal(body.request.destinationBinding.walletControlVerification, 'unverified');
  assert.equal((await store.list('11111111-1111-4111-8111-111111111111')).length, 1);
  assert.equal(await store.get('22222222-2222-4222-8222-222222222222', body.request.id), undefined);
  const repeat = await submit(walletIntent); assert.equal(repeat.status, 202); assert.equal(((await repeat.json()) as { request: { id: string } }).request.id, body.request.id);
  const conflict = await submit(fixedWalletReadinessIntent(`0x${'5'.repeat(40)}`)); assert.equal(conflict.status, 409); assert.match(await conflict.text(), /OPEN_REQUEST_CONFLICT/);
});

test('logout revokes the database-style session and protected history requires authentication', async t => {
  const { base, cookieA } = await fixture(t);
  assert.equal((await fetch(`${base}/api/v1/order-requests`, { headers: { cookie: cookieA } })).status, 200);
  assert.equal((await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { cookie: cookieA, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfA }, body: '{}' })).status, 200);
  assert.equal((await fetch(`${base}/api/v1/order-requests`, { headers: { cookie: cookieA } })).status, 401);
});

test('standalone server rate limits clients', async t => {
  const { base } = await fixture(t, 2);
  assert.equal((await fetch(`${base}/api/v1/capabilities`)).status, 200);
  assert.equal((await fetch(`${base}/api/v1/capabilities`)).status, 200);
  assert.equal((await fetch(`${base}/api/v1/capabilities`)).status, 429);
});

test('agent endpoint labels limited mode, validates language, and requires CSRF for signed-in reads', async t => {
  const { base, cookieA } = await fixture(t);
  const capabilities = await (await fetch(`${base}/api/v1/capabilities`)).json() as { agent: { mode: string; reason: string } };
  assert.equal(capabilities.agent.mode, 'limited'); assert.match(capabilities.agent.reason, /credentials/i);
  const guest = await fetch(`${base}/api/v1/agent/messages`, { method: 'POST', headers: { origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' }, body: JSON.stringify({ message: 'What route is supported?', locale: 'en' }) });
  assert.equal(guest.status, 200); assert.match(await guest.text(), /Limited mode/i);
  const noCsrf = await fetch(`${base}/api/v1/agent/messages`, { method: 'POST', headers: { cookie: cookieA, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Show my orders', locale: 'en' }) });
  assert.equal(noCsrf.status, 403);
  const unsupported = await fetch(`${base}/api/v1/agent/messages`, { method: 'POST', headers: { origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Hello', locale: 'zu' }) });
  assert.equal(unsupported.status, 400); assert.match(await unsupported.text(), /UNSUPPORTED_LANGUAGE/);
});

test('agent endpoint has a tighter independent request rate limit', async t => {
  const { base } = await fixture(t, 20, 2);
  const request = () => fetch(`${base}/api/v1/agent/messages`, { method: 'POST', headers: { origin: 'http://127.0.0.1:8787', 'content-type': 'application/json' }, body: JSON.stringify({ message: 'What route is supported?', locale: 'en' }) });
  assert.equal((await request()).status, 200); assert.equal((await request()).status, 200);
  const limited = await request(); assert.equal(limited.status, 429); assert.match(await limited.text(), /AGENT_RATE_LIMITED/);
});

test('voice endpoints require account, CSRF, consent, valid duration and supported output language, then clean audio memory', async t => {
  let captured: Uint8Array | undefined; const calls: string[] = [];
  const speech: SpeechProvider = {
    status: { enabled: true, provider: 'groq', externalRequestsApproved: true, liveValidated: false, transcription: { model: 'whisper-large-v3-turbo', locales: ['en','fr','ar'], providerDocumentationVerified: true }, synthesis: { locales: ['en','ar'], models: { en: 'canopylabs/orpheus-v1-english', ar: 'canopylabs/orpheus-arabic-saudi' }, providerDocumentationVerified: true }, limits: SPEECH_LIMITS, retention: 'memory-only-until-provider-response' },
    async transcribe(audio, type, locale) { captured = audio; calls.push(`transcribe:${type}:${locale}`); return 'Prepare 0.01 TAZ for 1 test USDC'; },
    async synthesize(text, locale) { calls.push(`speak:${locale}:${text}`); return new Uint8Array([82,73,70,70]); },
  };
  const { base, cookieA, store } = await fixture(t, 30, 20, undefined, speech);
  const publicCapabilities = await (await fetch(`${base}/api/v1/capabilities`)).json() as { voice: { enabled: boolean; liveValidated: boolean } };
  assert.deepEqual(publicCapabilities.voice, { ...speech.status });
  const audioHeaders = { origin: 'http://127.0.0.1:8787', 'content-type': 'audio/webm', 'x-speech-locale': 'en', 'x-audio-duration-ms': '1200', 'x-voice-consent': 'audio-processing-and-retention-accepted' };
  assert.equal((await fetch(`${base}/api/v1/voice/transcriptions`, { method: 'POST', headers: audioHeaders, body: new Uint8Array([7,8,9]) })).status, 401);
  assert.equal((await fetch(`${base}/api/v1/voice/transcriptions`, { method: 'POST', headers: { ...audioHeaders, cookie: cookieA }, body: new Uint8Array([7,8,9]) })).status, 403);
  const noConsent = { ...audioHeaders, cookie: cookieA, 'x-csrf-token': csrfA }; delete (noConsent as Partial<typeof noConsent>)['x-voice-consent'];
  assert.equal((await fetch(`${base}/api/v1/voice/transcriptions`, { method: 'POST', headers: noConsent, body: new Uint8Array([7,8,9]) })).status, 403);
  const tooShort = await fetch(`${base}/api/v1/voice/transcriptions`, { method: 'POST', headers: { ...audioHeaders, cookie: cookieA, 'x-csrf-token': csrfA, 'x-audio-duration-ms': '100' }, body: new Uint8Array([7]) });
  assert.equal(tooShort.status, 422); assert.match(await tooShort.text(), /AUDIO_TOO_SHORT/);
  const transcript = await fetch(`${base}/api/v1/voice/transcriptions`, { method: 'POST', headers: { ...audioHeaders, cookie: cookieA, 'x-csrf-token': csrfA }, body: new Uint8Array([7,8,9]) });
  assert.equal(transcript.status, 200); assert.match(await transcript.text(), /canAuthorizePayment.*false/); assert.deepEqual([...captured!], [0,0,0], 'audio memory must be cleared after provider response');
  const french = await fetch(`${base}/api/v1/voice/speech`, { method: 'POST', headers: { origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', cookie: cookieA, 'x-csrf-token': csrfA, 'x-voice-consent': 'audio-processing-and-retention-accepted' }, body: JSON.stringify({ text: 'Bonjour', locale: 'fr' }) });
  assert.equal(french.status, 422); assert.match(await french.text(), /VOICE_OUTPUT_UNSUPPORTED_LANGUAGE/);
  const spoken = await fetch(`${base}/api/v1/voice/speech`, { method: 'POST', headers: { origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', cookie: cookieA, 'x-csrf-token': csrfA, 'x-voice-consent': 'audio-processing-and-retention-accepted' }, body: JSON.stringify({ text: 'Review only.', locale: 'en' }) });
  assert.equal(spoken.status, 200); assert.equal(spoken.headers.get('content-type'), 'audio/wav'); assert.deepEqual(calls, ['transcribe:audio/webm:en', 'speak:en:Review only.']);
  assert.equal((await store.list('11111111-1111-4111-8111-111111111111')).length, 0, 'voice must not create an order');
});
