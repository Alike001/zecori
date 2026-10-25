import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplicationServer } from './app-server.ts';
import { MemoryPublicOrderRequestStore } from './public-order-store.ts';
import type { AuthenticatedUser, UserIdentityService } from './user-auth.ts';
import { fixedWalletReadinessIntent } from './wallet-intent.ts';

const recipient = `0x${'3'.repeat(40)}`;
const tokenA = 'a'.repeat(64); const tokenB = 'b'.repeat(64); const csrfA = 'c'.repeat(64); const csrfB = 'd'.repeat(64);

class TestIdentity implements UserIdentityService {
  readonly config = { rpName: 'Test', rpId: '127.0.0.1', expectedOrigin: 'http://127.0.0.1:8787', secureCookies: false };
  revoked = new Set<string>();
  async health() {}
  async session(request: Parameters<UserIdentityService['session']>[0]): Promise<AuthenticatedUser | undefined> {
    const token = request.headers.cookie?.match(/zecathon_session=([0-9a-f]{64})/)?.[1];
    if (!token || this.revoked.has(token)) return undefined;
    if (token === tokenA) return { userId: '11111111-1111-4111-8111-111111111111', displayName: 'User A', csrfToken: csrfA, passkeyCount: 2, sessionToken: token };
    if (token === tokenB) return { userId: '22222222-2222-4222-8222-222222222222', displayName: 'User B', csrfToken: csrfB, passkeyCount: 1, sessionToken: token };
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

async function fixture(t: TestContext, maximum = 20, agentMaximum = 10) {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-server-'));
  await mkdir(join(folder, 'assets'));
  await writeFile(join(folder, 'index.html'), '<!doctype html><main>zecathon-production</main>');
  await writeFile(join(folder, 'assets', 'app.js'), 'globalThis.loaded=true');
  const store = new MemoryPublicOrderRequestStore();
  const server = createApplicationServer({
    store, auth: new TestIdentity(), publicOrigin: 'http://127.0.0.1:8787',
    staticDirectory: folder, rateLimit: { windowMs: 60_000, maximum }, agentRateLimit: { windowMs: 60_000, maximum: agentMaximum },
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server address unavailable');
  return { base: `http://127.0.0.1:${address.port}`, cookieA: `zecathon_session=${tokenA}; zecathon_csrf=${csrfA}`, cookieB: `zecathon_session=${tokenB}; zecathon_csrf=${csrfB}`, store };
}

test('standalone server provides health checks, static assets, and SPA deep links', async t => {
  const { base } = await fixture(t);
  assert.equal((await fetch(`${base}/health/live`)).status, 200);
  assert.equal((await fetch(`${base}/health/ready`)).status, 200);
  assert.match(await (await fetch(`${base}/history/example`)).text(), /zecathon-production/);
  assert.match(await (await fetch(`${base}/assets/app.js`)).text(), /loaded/);
  assert.equal((await fetch(`${base}/api/orders`)).status, 404);
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

test('wallet intent rejects invalid recipients, unsupported networks, and premature payment attempts', async t => {
  const { base, cookieA, store } = await fixture(t);
  const headers = { cookie: cookieA, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfA };
  const submit = (body: unknown) => fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers, body: JSON.stringify(body) });

  const invalidRecipient = await submit({ ...walletIntent, destination: { ...walletIntent.destination, address: '0x1234' } });
  assert.equal(invalidRecipient.status, 400); assert.match(await invalidRecipient.text(), /INVALID_DESTINATION_RECIPIENT/);
  const transparent = await submit({ ...walletIntent, source: { ...walletIntent.source, pool: 'transparent' } });
  assert.equal(transparent.status, 400); assert.match(await transparent.text(), /UNSUPPORTED_SOURCE_POOL/);
  const mainnet = await submit({ ...walletIntent, destination: { ...walletIntent.destination, network: 'base-mainnet', chainId: 8453 } });
  assert.equal(mainnet.status, 400); assert.match(await mainnet.text(), /UNSUPPORTED_DESTINATION_NETWORK/);
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
