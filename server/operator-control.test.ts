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
import type { RpcCall } from './rpc-client.ts';

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

function rpcFor(address: string, index: string, onDerive?: () => void): RpcCall {
  return async <T>(method: string) => {
    const values: Record<string, unknown> = {
      getblockchaininfo: { chain: 'test', blocks: 500, headers: 500, initialblockdownload: false },
      getwalletinfo: { scanning: false, enhanced_through: 500, unlocked_until: 0 },
      getaddressinfo: { address, ismine: true, isvalid_orchard: true, receiver_types: ['orchard'], receivers_consistent: true, diversifier_index: index },
      z_listtransactions: [],
    };
    if (method === 'z_getaddressforaccount') { onDerive?.(); return { address, diversifier_index: index, receiver_types: ['orchard'] } as T; }
    return values[method] as T;
  };
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

test('recovers the same derivation after expiry and at every durable crash point', async () => {
  const scenarios = [
    { orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', index: '900719925474099312345', address: 'utest1freshorchardreceiver123456789', crash: 'pending' },
    { orderId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', index: '900719925474099312346', address: 'utest1freshorchardreceiver223456789', crash: 'derived' },
    { orderId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', index: '900719925474099312347', address: 'utest1freshorchardreceiver323456789', crash: 'bound' },
  ] as const;
  for (const scenario of scenarios) {
    const f = await fixture(); const now = Date.now() - 5_000; const binding = await prepare(f, scenario.orderId, now);
    const id = await f.controls.authorize({ action: 'ADDRESS_ALLOCATION', target: `order:${scenario.orderId}`, operatorId: 'operator-1', orderBinding: binding, diversifierIndex: scenario.index, ttlSeconds: 1, now });
    await f.controls.begin({ authorizationId: id, action: 'ADDRESS_ALLOCATION', target: `order:${scenario.orderId}`, operatorId: 'operator-1', orderBinding: binding, now: now + 500 });
    if (scenario.crash === 'derived' || scenario.crash === 'bound') await f.controls.recordDerived(id, scenario.address, scenario.index, now + 600);
    if (scenario.crash === 'bound') {
      const record = (await f.controls.inspect()).allocations[0];
      await f.orders.bindReceivingAddressToPreparedOrder(scenario.orderId, scenario.address, async () => ({ allocationId: record.allocationId, address: scenario.address, diversifierIndex: scenario.index, validatedAt: new Date(now).toISOString(), sourceNotBeforeHeight: 501, state: 'AVAILABLE' }), now + 700);
    }
    let derivations = 0;
    const allocationId = await executeAuthorizedAddressAllocation({ authorizationId: id, orderId: scenario.orderId, operatorId: 'operator-1', controls: f.controls, orders: f.orders, rpc: rpcFor(scenario.address, scenario.index, () => { derivations += 1; }) });
    assert.equal(derivations, scenario.crash === 'pending' ? 1 : 0);
    assert.equal((await f.controls.inspect()).allocations[0].state, 'RESERVED');
    assert.equal((await f.orders.operatorOrderManifest(scenario.orderId)).allocationId, allocationId);
    assert.equal((await f.orders.operatorSnapshot()).allocationCounts.assigned, 1);
    assert.equal(await executeAuthorizedAddressAllocation({ authorizationId: id, orderId: scenario.orderId, operatorId: 'operator-1', controls: f.controls, orders: f.orders, rpc: rpcFor(scenario.address, scenario.index) }), allocationId);
  }
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

test('an interrupted derivation is reconciled after order expiry without activating payment', async () => {
  const f = await fixture(); const preparedAt = Date.now() - 120_000; const orderId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const binding = createOperatorOrderBinding({ orderId, destinationRecipient: recipient, expiresAt: new Date(Date.now() - 60_000).toISOString(), now: preparedAt });
  const signature = await f.controls.signOrderManifest(binding, 'operator-1');
  await f.orders.prepareOperatorOrder(binding, 'operator-1', signature, preparedAt);
  const id = await f.controls.authorize({ action: 'ADDRESS_ALLOCATION', target: `order:${orderId}`, operatorId: 'operator-1', orderBinding: binding, diversifierIndex: '88', ttlSeconds: 1, now: preparedAt });
  await f.controls.begin({ authorizationId: id, action: 'ADDRESS_ALLOCATION', target: `order:${orderId}`, operatorId: 'operator-1', orderBinding: binding, now: preparedAt + 500 });
  await f.controls.recordDerived(id, 'utest1expiredrecoveryreceiver123456789', '88', preparedAt + 600);
  await executeAuthorizedAddressAllocation({ authorizationId: id, orderId, operatorId: 'operator-1', controls: f.controls, orders: f.orders, rpc: rpcFor('utest1expiredrecoveryreceiver123456789', '88') });
  assert.equal((await f.orders.operatorSnapshot()).orders[0].status, 'FAILED');
  assert.equal((await f.orders.operatorOrderManifest(orderId)).state, 'ADDRESS_ALLOCATED');
});
