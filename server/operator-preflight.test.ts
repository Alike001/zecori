import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileOrderStore } from './order-api.ts';
import { OperatorControlStore } from './operator-control.ts';
import { checkLiquidity, previewTerms, runOperatorPreflight } from './operator-preflight.ts';
import type { RpcCall } from './rpc-client.ts';
import { createOperatorOrderBinding } from '../src/lib/operator-order.ts';

const lp = `0x${'1'.repeat(40)}`; const recipient = `0x${'2'.repeat(40)}`;
function zcashRpc(): RpcCall { return async <T>(method: string) => ({
  getblockchaininfo: { chain: 'test', blocks: 500, headers: 500, initialblockdownload: false },
  getwalletinfo: { walletname: 'default', private_keys_enabled: true, scanning: false, enhanced_through: 500, unlocked_until: 0 },
}[method] as T); }
function baseRpc(usdc = 1_000_000n, eth = 100_000_000_000_000n): RpcCall { return async <T>(method: string) => ({
  eth_chainId: '0x14a34', eth_getCode: '0x6001', eth_blockNumber: '0x64', eth_getBlockByNumber: { number: '0x64', hash: `0x${'a'.repeat(64)}` }, eth_call: `0x${usdc.toString(16)}`, eth_getBalance: `0x${eth.toString(16)}`,
}[method] as T); }

test('previews exact disclosed terms without creating an order', () => {
  const preview = previewTerms(recipient, 1_900_000_000_000, 30);
  assert.equal(preview.source.amountZatoshis, '1000000'); assert.equal(preview.destination.amountAtomic, '1000000');
  assert.match(preview.fixedRate, /1 TAZ = 100 test USDC/); assert.match(preview.policies.refunds, /manual/);
});

test('reads exact test-USDC and gas balances', async () => {
  const result = await checkLiquidity(lp, baseRpc(2_000_000n, 200_000_000_000_000n));
  assert.equal(result.usdcAtomic, '2000000'); assert.equal(result.ethWei, '200000000000000');
  assert.equal(result.sufficientUsdc, true); assert.equal(result.sufficientGas, true);
});

test('passes complete read-only preflight only with private database, fresh allocation, liquidity and confirmed recipient', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-preflight-')); await chmod(folder, 0o700);
  const key = join(folder, 'operator.key'); await writeFile(key, randomBytes(32), { mode: 0o600 });
  const orders = new FileOrderStore(join(folder, 'orders.json'));
  await orders.reserveReceivingAddress('utest1freshorchardreceiver123456789', async () => ({ allocationId: 'allocation-1', address: 'utest1freshorchardreceiver123456789', diversifierIndex: '900719925474099312345', validatedAt: new Date().toISOString(), sourceNotBeforeHeight: 501, state: 'AVAILABLE' }));
  const controls = new OperatorControlStore(join(folder, 'control.json'), key);
  await controls.initialize();
  const result = await runOperatorPreflight({ lpAddress: lp, recipient, confirmedRecipient: recipient, zcashRpc: zcashRpc(), baseRpc: baseRpc(), orders, controls, operatorKeyStatus: { ready: true } });
  assert.equal(result.readyForFirstPayment, true); assert.deepEqual(result.blockers, []); assert.equal(result.historicalEvidenceEligible, false);
});

test('reaches OPERATOR_CONFIGURED without deriving or reserving a Zcash address', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-configured-')); await chmod(folder, 0o700);
  const key = join(folder, 'operator.key'); await writeFile(key, randomBytes(32), { mode: 0o600 });
  const orders = new FileOrderStore(join(folder, 'orders.json')); await orders.initialize();
  const controls = new OperatorControlStore(join(folder, 'control.json'), key); await controls.initialize();
  const result = await runOperatorPreflight({ lpAddress: lp, recipient, confirmedRecipient: recipient, zcashRpc: zcashRpc(), baseRpc: baseRpc(), orders, controls, operatorKeyStatus: { ready: true }, requireFreshAllocation: false });
  assert.equal(result.stage, 'OPERATOR_CONFIGURED');
  assert.equal(result.operatorConfigured, true);
  assert.equal(result.readyForFirstPayment, false);
  assert.equal(result.allocationCounts.available, 0);
  const strict = await runOperatorPreflight({ lpAddress: lp, recipient, confirmedRecipient: recipient, zcashRpc: zcashRpc(), baseRpc: baseRpc(), orders, controls, operatorKeyStatus: { ready: true } });
  assert.equal(strict.operatorConfigured, true);
  assert.equal(strict.readyForFirstPayment, false);
  assert.match(strict.blockers.join(' | '), /fresh Orchard receiving address/);
});

test('strict preflight accepts exactly one durably bound inactive operator order', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-bound-order-')); await chmod(folder, 0o700);
  const key = join(folder, 'operator.key'); await writeFile(key, randomBytes(32), { mode: 0o600 });
  const orders = new FileOrderStore(join(folder, 'orders.json')); await orders.initialize();
  const controls = new OperatorControlStore(join(folder, 'control.json'), key); await controls.initialize();
  const now = 1_900_000_000_000; const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const binding = createOperatorOrderBinding({ orderId, destinationRecipient: recipient, expiresAt: new Date(now + 3_600_000).toISOString(), now });
  await orders.prepareOperatorOrder(binding, 'operator-1', 'a'.repeat(64), now);
  const authorizationId = await controls.authorize({ action: 'ADDRESS_ALLOCATION', target: `order:${orderId}`, operatorId: 'operator-1', orderBinding: binding, diversifierIndex: '44', now });
  await controls.begin({ authorizationId, action: 'ADDRESS_ALLOCATION', target: `order:${orderId}`, operatorId: 'operator-1', orderBinding: binding, now: now + 1 });
  await controls.recordDerived(authorizationId, 'utest1boundorchardreceiver123456789', '44', now + 2);
  const allocationId = (await controls.inspect()).allocations[0].allocationId;
  await orders.bindReceivingAddressToPreparedOrder(orderId, 'utest1boundorchardreceiver123456789', async () => ({ allocationId, address: 'utest1boundorchardreceiver123456789', diversifierIndex: '44', validatedAt: new Date(now).toISOString(), sourceNotBeforeHeight: 501, state: 'AVAILABLE' }), now + 3);
  await controls.completeAddressAllocation(authorizationId, now + 4);
  const result = await runOperatorPreflight({ lpAddress: lp, recipient, confirmedRecipient: recipient, zcashRpc: zcashRpc(), baseRpc: baseRpc(), orders, controls, operatorKeyStatus: { ready: true } });
  assert.equal(result.readyForFirstPayment, true); assert.deepEqual(result.blockers, []); assert.equal(result.allocationCounts.assigned, 1);
});

test('fails closed for insufficient liquidity, missing recipient confirmation and absent database', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-preflight-pending-'));
  const result = await runOperatorPreflight({ lpAddress: lp, recipient, confirmedRecipient: undefined, zcashRpc: zcashRpc(), baseRpc: baseRpc(0n, 0n), orders: new FileOrderStore(join(folder, 'missing.json')), controls: new OperatorControlStore(join(folder, 'control.json'), join(folder, 'missing.key')), operatorKeyStatus: { ready: false, reason: 'operator key is not provisioned' } });
  assert.equal(result.readyForFirstPayment, false);
  assert.match(result.blockers.join(' | '), /insufficient.*liquidity|recipient.*confirmed|not initialized|not provisioned/);
});
