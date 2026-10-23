import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplicationServer } from './app-server.ts';
import { MemoryPublicOrderRequestStore } from './public-order-store.ts';

const recipient = `0x${'3'.repeat(40)}`;

async function fixture(t: TestContext, maximum = 20) {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-server-'));
  await mkdir(join(folder, 'assets'));
  await writeFile(join(folder, 'index.html'), '<!doctype html><main>zecathon-production</main>');
  await writeFile(join(folder, 'assets', 'app.js'), 'globalThis.loaded=true');
  const server = createApplicationServer({
    store: new MemoryPublicOrderRequestStore(), publicOrigin: 'http://127.0.0.1:8787', destinationRecipient: recipient,
    staticDirectory: folder, rateLimit: { windowMs: 60_000, maximum },
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('server address unavailable');
  return `http://127.0.0.1:${address.port}`;
}

test('standalone server provides health checks, static assets, and SPA deep links', async t => {
  const base = await fixture(t);
  assert.equal((await fetch(`${base}/health/live`)).status, 200);
  assert.equal((await fetch(`${base}/health/ready`)).status, 200);
  assert.match(await (await fetch(`${base}/history/example`)).text(), /zecathon-production/);
  assert.match(await (await fetch(`${base}/assets/app.js`)).text(), /loaded/);
  assert.equal((await fetch(`${base}/api/orders`)).status, 404);
});

test('versioned public request API enforces session, origin, CSRF, exact terms, and ownership', async t => {
  const base = await fixture(t);
  const sessionResponse = await fetch(`${base}/api/v1/session`);
  const cookies = sessionResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const { csrfToken } = await sessionResponse.json() as { csrfToken: string };
  const denied = await fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers: { cookie: cookies, origin: 'https://attacker.invalid', 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' });
  assert.equal(denied.status, 403);
  const accepted = await fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers: { cookie: cookies, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' });
  assert.equal(accepted.status, 202);
  const created = await accepted.json() as { request: { id: string; destinationRecipient: string; status: string; terms: { source: { amountZatoshis: string }; destination: { amountAtomic: string } } } };
  assert.equal(created.request.destinationRecipient, recipient);
  assert.equal(created.request.status, 'AWAITING_OPERATOR');
  assert.equal(created.request.terms.source.amountZatoshis, '1000000');
  assert.equal(created.request.terms.destination.amountAtomic, '1000000');
  const duplicate = await fetch(`${base}/api/v1/order-requests`, { method: 'POST', headers: { cookie: cookies, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' });
  assert.equal((await duplicate.json() as { request: { id: string } }).request.id, created.request.id);
  const stranger = await fetch(`${base}/api/v1/order-requests/${created.request.id}`);
  assert.equal(stranger.status, 404);
  for (const action of ['approve-payout', 'derive-address', 'broadcast', 'wallet-rpc']) {
    assert.equal((await fetch(`${base}/api/v1/orders/example/${action}`, { method: 'POST', headers: { cookie: cookies, origin: 'http://127.0.0.1:8787', 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' })).status, 404);
  }
});

test('standalone server rate limits clients', async t => {
  const base = await fixture(t, 2);
  assert.equal((await fetch(`${base}/api/v1/capabilities`)).status, 200);
  assert.equal((await fetch(`${base}/api/v1/capabilities`)).status, 200);
  assert.equal((await fetch(`${base}/api/v1/capabilities`)).status, 429);
});
