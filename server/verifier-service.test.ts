import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifierServer } from './verifier-service.ts';

test('isolated verifier exposes health but requires service authorization for verification', async t => {
  const server = createVerifierServer('a'.repeat(32));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('address unavailable');
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${base}/health/live`)).status, 200);
  assert.equal((await fetch(`${base}/v1/base/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  const invalid = await fetch(`${base}/v1/base/verify`, { method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(32)}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(invalid.status, 400);
  assert.match(await invalid.text(), /Exact order/);
  assert.equal((await fetch(`${base}/v1/zcash/rpc`, { headers: { authorization: `Bearer ${'a'.repeat(32)}` } })).status, 404);
});
