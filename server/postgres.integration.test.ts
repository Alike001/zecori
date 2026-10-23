import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createPostgresPool, migrateDatabase } from './postgres.ts';
import { PostgresPublicOrderRequestStore } from './public-order-store.ts';

const databaseUrl = process.env.POSTGRES_TEST_URL;

test('PostgreSQL migration, concurrent request idempotency, restart persistence, and immutable audit constraints', { skip: !databaseUrl }, async () => {
  const firstPool = createPostgresPool(databaseUrl);
  await migrateDatabase(firstPool);
  const firstStore = new PostgresPublicOrderRequestStore(firstPool);
  const owner = randomUUID(); const recipient = `0x${'4'.repeat(40)}`;
  const attempts = await Promise.all(Array.from({ length: 8 }, () => firstStore.create(owner, recipient)));
  assert.equal(new Set(attempts.map(item => item.id)).size, 1);
  const id = attempts[0].id;
  await firstPool.end();

  const restartedPool = createPostgresPool(databaseUrl);
  const restartedStore = new PostgresPublicOrderRequestStore(restartedPool);
  assert.equal((await restartedStore.get(owner, id))?.destinationRecipient, recipient);

  const orderId = randomUUID(); const now = new Date(); const later = new Date(now.getTime() + 3_600_000);
  await restartedPool.query(`INSERT INTO orders
    (order_id, owner_session_hash, immutable_manifest, public_view, encrypted_private_state, encryption_key_version, status, created_at, expires_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,1,'CREATED',$6,$7,$6)`, [orderId, createHash('sha256').update(owner).digest(), { exact: true }, { id: orderId }, Buffer.from('encrypted-fixture'), now, later]);
  await assert.rejects(restartedPool.query(`UPDATE orders SET immutable_manifest = $2, state_version = 1, updated_at = now() WHERE order_id = $1`, [orderId, { exact: false }]), /immutable order fields/);
  const audit = await restartedPool.query<{ event_id: string }>(`INSERT INTO audit_events(order_id, actor_type, event_type) VALUES ($1,'SYSTEM','TEST') RETURNING event_id`, [orderId]);
  await assert.rejects(restartedPool.query(`UPDATE audit_events SET event_type = 'ALTERED' WHERE event_id = $1`, [audit.rows[0].event_id]), /append-only/);
  await restartedPool.end();
});
