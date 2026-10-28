import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertPrivateRequestAllowed, loadPrivateRequestWindow, type PrivateRequestWindow } from './private-request-window.ts';
import { fixedWalletReadinessIntent } from './wallet-intent.ts';
import { createPostgresPool, migrateDatabase } from './postgres.ts';
import { DataEncryption } from './data-encryption.ts';
import { PostgresPublicOrderRequestStore } from './public-order-store.ts';

const recipient = '0x1234567890123456789012345678901234567890';
function policy(): PrivateRequestWindow {
  return { version: 1, state: 'ACTIVE', origin: 'http://localhost:8788', database: 'zecori_linked_settlement_01', maximumRequests: 1,
    routeId: 'zcash-testnet-to-base-sepolia-fixed', sourceZatoshis: '1000000', destinationAtomic: '1000000', chainId: 84532,
    token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', recipient, sourceConfirmations: 10, destinationConfirmations: 3,
    openedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString(), approval: 'TEST-ONLY approval' };
}
test('private request scope refuses prepared/expired windows and changed recipient/route terms', () => {
  const p = policy(), intent = fixedWalletReadinessIntent(recipient);
  assert.doesNotThrow(() => assertPrivateRequestAllowed(p, intent));
  assert.throws(() => assertPrivateRequestAllowed({ ...p, state: 'PREPARED' }, intent), /closed/);
  assert.throws(() => assertPrivateRequestAllowed(p, intent, Date.parse(p.expiresAt!)), /closed/);
  assert.throws(() => assertPrivateRequestAllowed(p, fixedWalletReadinessIntent('0x2222222222222222222222222222222222222222')), /differs/);
  assert.throws(() => assertPrivateRequestAllowed({ ...p, maximumRequests: 2 } as unknown as PrivateRequestWindow, intent), /scope/);
  assert.throws(() => assertPrivateRequestAllowed({ ...p, expiresAt: new Date(Date.now() + 700_000).toISOString() }, intent), /ten minutes/);
});
test('private policy refuses insecure files, other origins/databases and URL host overrides', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'zecori-window-policy-')); await chmod(folder, 0o700);
  const file = join(folder, 'policy.json'); await writeFile(file, JSON.stringify(policy()), { mode: 0o600 });
  const url = 'postgresql://zecori_linked_runtime:TEST-ONLY@127.0.0.1:55440/zecori_linked_settlement_01?application_name=zecori-linked-settlement-01';
  assert.ok(await loadPrivateRequestWindow(file, 'http://localhost:8788', url));
  await assert.rejects(loadPrivateRequestWindow(file, 'https://zecori.iamalikex.tech', url), /another app/);
  await assert.rejects(loadPrivateRequestWindow(file, 'http://localhost:8788', url.replace(':55440/', ':55439/')), /another app/);
  await assert.rejects(loadPrivateRequestWindow(file, 'http://localhost:8788', url + '&host=production.invalid'), /another app/);
  await chmod(file, 0o644); await assert.rejects(loadPrivateRequestWindow(file, 'http://localhost:8788', url), /0600/);
});
test('TEST-ONLY fresh disposable DB: exactly one concurrent request globally, including after restart', { skip: !process.env.PRIVATE_WINDOW_TEST_URL }, async () => {
  const url = process.env.PRIVATE_WINDOW_TEST_URL!;
  assert.match(new URL(url).pathname, /_window_test$/);
  const pool = createPostgresPool(url); await migrateDatabase(pool);
  try {
    assert.equal((await pool.query('SELECT count(*) FROM public_order_requests')).rows[0].count, '0');
    const owners = Array.from({ length: 4 }, () => randomUUID());
    for (const id of owners) await pool.query("INSERT INTO users(user_id,display_name,status,activated_at) VALUES($1,'TEST-ONLY window owner','ACTIVE',now())", [id]);
    const encryption = new DataEncryption({ activeVersion: 1, keys: new Map([[1, randomBytes(32)]]) });
    const p = policy(), store = new PostgresPublicOrderRequestStore(pool, encryption, p);
    await assert.rejects(new PostgresPublicOrderRequestStore(pool, encryption, { ...p, state: 'PREPARED' }).create(owners[0], fixedWalletReadinessIntent(recipient)), /closed/);
    await assert.rejects(store.create(owners[0], fixedWalletReadinessIntent('0x2222222222222222222222222222222222222222')), /differs/);
    const results = await Promise.allSettled(owners.map(owner => store.create(owner, fixedWalletReadinessIntent(recipient))));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await pool.query('SELECT count(*) FROM public_order_requests')).rows[0].count, '1');
    assert.equal((await pool.query('SELECT count(*) FROM orders')).rows[0].count, '0');
    const restarted = createPostgresPool(url);
    try { await assert.rejects(new PostgresPublicOrderRequestStore(restarted, encryption, p).create(owners[0], fixedWalletReadinessIntent(recipient)), /already been created/); }
    finally { await restarted.end(); }
  } finally { await pool.end(); }
});
