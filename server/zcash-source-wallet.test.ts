import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSourceWalletA } from './zcash-source-wallet.ts';
import type { RpcCall } from './rpc-client.ts';

function walletRpc(overrides: Record<string, unknown> = {}): { call: RpcCall; methods: string[] } {
  const methods: string[] = [];
  const values: Record<string, unknown> = {
    getblockchaininfo: { chain: 'test', blocks: 500, headers: 500, initialblockdownload: false },
    getwalletinfo: { scanning: false, enhanced_through: 500, unlocked_until: 0 },
    z_getbalanceforaccount: { pools: { orchard: { valueZat: 1_000_000 }, sapling: { valueZat: '10000' } }, minimum_confirmations: 10 },
    ...overrides,
  };
  return { methods, call: async <T>(method: string) => { methods.push(method); return values[method] as T; } };
}

test('checks exact confirmed Wallet A testnet balance without unlocking or spending', async () => {
  const rpc = walletRpc(); const result = await checkSourceWalletA(rpc.call);
  assert.equal(result.confirmedZatoshis, '1010000');
  assert.equal(result.requiredZatoshis, '1010000');
  assert.equal(result.sufficientForPaymentAndFeeReserve, true);
  assert.deepEqual(rpc.methods.sort(), ['getblockchaininfo', 'getwalletinfo', 'z_getbalanceforaccount'].sort());
});

test('fails closed for wrong network, incomplete history, unlocked wallet, malformed values and insufficient funds', async () => {
  await assert.rejects(checkSourceWalletA(walletRpc({ getblockchaininfo: { chain: 'main', blocks: 500, headers: 500, initialblockdownload: false } }).call), /testnet/);
  await assert.rejects(checkSourceWalletA(walletRpc({ getwalletinfo: { scanning: { progress: 0.9 }, enhanced_through: 499, unlocked_until: 0 } }).call), /incomplete/);
  await assert.rejects(checkSourceWalletA(walletRpc({ getwalletinfo: { scanning: false, enhanced_through: 500, unlocked_until: Math.floor(Date.now() / 1000) + 60 } }).call), /locked/);
  await assert.rejects(checkSourceWalletA(walletRpc({ z_getbalanceforaccount: { pools: { orchard: { valueZat: 1.5 } }, minimum_confirmations: 10 } }).call), /exact/);
  const insufficient = await checkSourceWalletA(walletRpc({ z_getbalanceforaccount: { pools: { orchard: { valueZat: 1_009_999 } }, minimum_confirmations: 10 } }).call);
  assert.equal(insufficient.sufficientForPaymentAndFeeReserve, false);
});
