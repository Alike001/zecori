import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOperatorOrderBinding, type OperatorOrderBinding } from '../src/lib/operator-order.ts';
import { executeAuthorizedAddressAllocation } from './operator-actions.ts';
import { FileOrderStore } from './order-api.ts';
import { exactDiversifier, OperatorControlStore } from './operator-control.ts';

const recipient = `0x${'2'.repeat(40)}`;

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-operator-'));
  await chmod(folder, 0o700);
  const key = join(folder, 'operator.key'); await writeFile(key, randomBytes(32), { mode: 0o600 });
  const controls = new OperatorControlStore(join(folder, 'control.json'), key); await controls.initialize();
  const orders = new FileOrderStore(join(folder, 'orders.json')); await orders.initialize();
  return { controls, orders };
}

async function prepare(f: Awaited<ReturnType<typeof fixture>>, orderId: string, now = 1_900_000_000_000): Promise<OperatorOrderBinding> {
  const binding = createOperatorOrderBinding({ orderId, destinationRecipient: recipient, expiresAt: new Date(now + 3_600_000).toISOString(), now });
  const signature = await f.controls.signOrderManifest(binding, 'operator-1');
  await f.orders.prepareOperatorOrder(binding, 'operator-1', signature, now);
  return binding;
}

test('keeps diversifiers exact beyond JavaScript safe integer range', () => {
  assert.equal(exactDiversifier('900719925474099312345'), '900719925474099312345');
  assert.throws(() => exactDiversifier(((1n << 88n)).toString()), /88-bit/);
});

test('binds signed address authorization to one immutable order manifest', async () => {
  const f = await fixture(); const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const binding = await prepare(f, orderId); const index = '900719925474099312345';
  const id = await f.controls.authorize({ action: 'ADDRESS_ALLOCATION', target: `order:${orderId}`, operatorId: 'operator-1', orderBinding: binding, diversifierIndex: index, now: 1_900_000_000_000 });
  await f.controls.begin({ authorizationId: id, action: 'ADDRESS_ALLOCATION', target: `order:${orderId}`, operatorId: 'operator-1', orderBinding: binding, now: 1_900_000_001_000 });
  const first = (await f.controls.inspect()).allocations[0];
  assert.equal(first.orderId, orderId); assert.equal(first.diversifierIndex, index); assert.equal(first.state, 'DERIVATION_PENDING');
  const different = { ...binding, destinationRecipient: `0x${'3'.repeat(40)}` };
  await assert.rejects(f.controls.begin({ authorizationId: id, action: 'ADDRESS_ALLOCATION', target: `order:${orderId}`, operatorId: 'operator-1', orderBinding: different, now: 1_900_000_002_000 }), /binding mismatch/);
  await assert.rejects(f.controls.authorize({ action: 'ADDRESS_ALLOCATION', target: `order:${orderId}`, operatorId: 'operator-1', orderBinding: binding, now: 1_900_000_002_000 }), /already in progress/);
});

test('legacy JSON allocation executor is disabled in favor of PostgreSQL recovery', async () => {
  await assert.rejects(executeAuthorizedAddressAllocation({ authorizationId: 'legacy', orderId: 'legacy-order', operatorId: 'operator-1' }), /Legacy JSON address allocation is disabled/);
});

test('expired unstarted authorization can be replaced but payout authorization still expires closed', async () => {
  const f = await fixture(); const now = 1_900_000_000_000; const orderId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const binding = await prepare(f, orderId, now);
  const first = await f.controls.authorize({ action: 'ADDRESS_ALLOCATION', target: `order:${orderId}`, operatorId: 'operator-1', orderBinding: binding, ttlSeconds: 1, now });
  const replacement = await f.controls.authorize({ action: 'ADDRESS_ALLOCATION', target: `order:${orderId}`, operatorId: 'operator-1', orderBinding: binding, now: now + 2_000 });
  assert.notEqual(first, replacement);
  assert.equal((await f.controls.inspect()).authorizations.find(item => item.id === first)?.state, 'REVOKED');
  const payout = await f.controls.authorize({ action: 'PAYOUT_APPROVAL', target: 'owner:order', operatorId: 'operator-1', ttlSeconds: 1, now });
  await assert.rejects(f.controls.begin({ authorizationId: payout, action: 'PAYOUT_APPROVAL', target: 'owner:order', operatorId: 'operator-1', now: now + 2_000 }), /expired/);
});

test('legacy JSON recovery cannot mutate an expired prepared order', async () => {
  await assert.rejects(executeAuthorizedAddressAllocation({ authorizationId: 'expired', orderId: 'expired-order', operatorId: 'operator-1' }), /PostgreSQL settlement operator/);
});
