import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSourceWalletA, exactZecToZatoshis } from './zcash-source-wallet.ts';
import type { RpcCall } from './rpc-client.ts';

function note(pool: string, amount: string, confirmations = 10) {
  return { pool, amount, confirmations, spendable: true, solvable: true, safe: true };
}

function walletRpc(overrides: Record<string, unknown> = {}): { call: RpcCall; requests: Array<[string, unknown[] | undefined]> } {
  const requests: Array<[string, unknown[] | undefined]> = [];
  const values: Record<string, unknown> = {
    getblockchaininfo: { chain: 'test', blocks: 500, headers: 500, initialblockdownload: false },
    getwalletinfo: { walletname: 'default', private_keys_enabled: true, scanning: false, enhanced_through: 500, unlocked_until: 0 },
    getbalance: '0.01010000',
    listunspent: [note('ironwood', '0.01010000')],
    ...overrides,
  };
  return { requests, call: async <T>(method: string, params?: unknown[]) => { requests.push([method, params]); return values[method] as T; } };
}

test('uses only pinned zecd balance RPCs and proves exact Ironwood funding', async () => {
  const rpc = walletRpc(); const result = await checkSourceWalletA(rpc.call);
  assert.equal(result.aggregateConfirmedZatoshis, '1010000');
  assert.equal(result.ironwoodUsableZatoshis, '1010000');
  assert.equal(result.confirmedZatoshis, '1010000');
  assert.equal(result.sufficientForPaymentAndFeeReserve, true);
  assert.equal(result.fullPrivacyCompatible, true);
  assert.deepEqual(rpc.requests.map(([method]) => method).sort(), ['getblockchaininfo', 'getwalletinfo', 'getbalance', 'listunspent'].sort());
  assert.deepEqual(rpc.requests.find(([method]) => method === 'getbalance')?.[1], ['*', 10]);
  assert.deepEqual(rpc.requests.find(([method]) => method === 'listunspent')?.[1], [10, 9_999_999, [], false]);
  assert.equal(rpc.requests.some(([method]) => method === 'z_getbalanceforaccount'), false);
});

test('does not count transparent, Sapling, or Orchard value as FullPrivacy-compatible funding', async () => {
  const result = await checkSourceWalletA(walletRpc({
    getbalance: '3.01009999',
    listunspent: [
      note('transparent', '1.00000000'),
      note('sapling', '1.00000000'),
      note('orchard', '1.00000000'),
      note('ironwood', '0.01009999'),
    ],
  }).call);
  assert.equal(result.aggregateConfirmedZatoshis, '301009999');
  assert.equal(result.ironwoodUsableZatoshis, '1009999');
  assert.equal(result.sufficientForPaymentAndFeeReserve, false);
  assert.equal(result.fullPrivacyCompatible, false);
});

test('requires testnet sync, configured wallet identity, ownership, complete history and locked state', async () => {
  await assert.rejects(checkSourceWalletA(walletRpc({ getblockchaininfo: { chain: 'main', blocks: 500, headers: 500, initialblockdownload: false } }).call), /testnet/);
  await assert.rejects(checkSourceWalletA(walletRpc({ getwalletinfo: { walletname: 'other', private_keys_enabled: true, scanning: false, enhanced_through: 500, unlocked_until: 0 } }).call), /identity/);
  await assert.rejects(checkSourceWalletA(walletRpc({ getwalletinfo: { walletname: 'default', private_keys_enabled: false, scanning: false, enhanced_through: 500, unlocked_until: 0 } }).call), /owned spending wallet/);
  await assert.rejects(checkSourceWalletA(walletRpc({ getwalletinfo: { walletname: 'default', private_keys_enabled: true, scanning: { progress: 0.9 }, enhanced_through: 499, unlocked_until: 0 } }).call), /incomplete/);
  await assert.rejects(checkSourceWalletA(walletRpc({ getwalletinfo: { walletname: 'default', private_keys_enabled: true, scanning: false, enhanced_through: 500, unlocked_until: 1 } }).call), /locked/);
});

test('fails closed for confirmations, unsafe notes, malformed decimals and inconsistent totals', async () => {
  await assert.rejects(checkSourceWalletA(walletRpc({ listunspent: [note('ironwood', '0.01010000', 9)] }).call), /confirmation/);
  await assert.rejects(checkSourceWalletA(walletRpc({ listunspent: [{ ...note('ironwood', '0.01010000'), safe: false }] }).call), /safely spendable/);
  await assert.rejects(checkSourceWalletA(walletRpc({ listunspent: [note('ironwood', '0.010100001')] }).call), /exact/);
  await assert.rejects(checkSourceWalletA(walletRpc({ getbalance: '0.01000000' }).call), /exceeds/);
  assert.throws(() => exactZecToZatoshis(0.0101, 'amount'), /exact/);
  assert.equal(exactZecToZatoshis('0.01010000', 'amount'), 1_010_000n);
});
