import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplicationServer } from './app-server.ts';
import { MemoryPublicOrderRequestStore } from './public-order-store.ts';
import type { AuthenticatedUser, UserIdentityService } from './user-auth.ts';

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

async function fixture(t: TestContext, maximum = 20) {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-server-'));
  await mkdir(join(folder, 'assets'));
  await writeFile(join(folder, 'index.html'), '<!doctype html><main>zecathon-production</main>');
  await writeFile(join(folder, 'assets', 'app.js'), 'globalThis.loaded=true');
  const server = createApplicationServer({
    store: new MemoryPublicOrderRequestStore(), auth: new TestIdentity(), publicOrigin: 'http://127.0.0.1:8787', destinationRecipient: recipient,
    staticDirectory: folder, rateLimit: { windowMs: 60_000, maximum },
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server address unavailable');
  return { base: `http://127.0.0.1:${address.port}`, cookieA: `zecathon_session=${tokenA}; zecathon_csrf=${csrfA}`, cookieB: `zecathon_session=${tokenB}; zecathon_csrf=${csrfB}` };
}

test('standalone server provides health checks, static assets, and SPA deep links', async t => {
  const { base } = await fixture(t);
  assert.equal((await fetch(`${base}/health/live`)).status, 200);
  assert.equal((await fetch(`${base}/health/ready`)).status, 200);
  assert.match(await (await fetch(`${base}/history/example`)).text(), /zecathon-production/);
  assert.match(await (await fetch(`${base}/assets/app.js`)).text(), /loaded/);
  assert.equal((await fetch(`${base}/api/orders`)).status, 404);
});

test('versioned public request API enforces session, origin, CSRF, exact terms, and ownership', async t => {
  const { base, cookieA, cookieB } = await fixture(t);
  const sessionResponse = await fetch(`${base}/api/v1/session`, { headers: { cookie: cookieA } });
  const { csrfToken } = await sessionResponse.json() as { csrfToken: string };
  const denied = await fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers: { cookie: cookieA, origin: 'https://attacker.invalid', 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' });
  assert.equal(denied.status, 403);
  const accepted = await fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers: { cookie: cookieA, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' });
  assert.equal(accepted.status, 202);
  const created = await accepted.json() as { request: { id: string; destinationRecipient: string; status: string; terms: { source: { amountZatoshis: string }; destination: { amountAtomic: string } } } };
  assert.equal(created.request.destinationRecipient, recipient);
  assert.equal(created.request.status, 'AWAITING_OPERATOR');
  assert.equal(created.request.terms.source.amountZatoshis, '1000000');
  assert.equal(created.request.terms.destination.amountAtomic, '1000000');
  const duplicate = await fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers: { cookie: cookieA, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' });
  assert.equal((await duplicate.json() as { request: { id: string } }).request.id, created.request.id);
  const stranger = await fetch(`${base}/api/v1/order-requests/${created.request.id}`, { headers: { cookie: cookieB } });
  assert.equal(stranger.status, 404);
  for (const action of ['approve-payout', 'derive-address', 'broadcast', 'wallet-rpc']) {
    assert.equal((await fetch(`${base}/api/v1/orders/example/${action}`, { method: 'POST', headers: { cookie: cookieA, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' })).status, 404);
  }
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
