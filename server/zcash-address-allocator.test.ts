import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUnusedWalletBAddress, WALLET_B_ADDRESS_ALLOCATION_PLAN } from './zcash-address-allocator.ts';
import type { RpcCall } from './rpc-client.ts';

const address = 'utest1freshorchardreceiver123456789';

function rpc(history: unknown[] = [], overrides: Record<string, unknown> = {}): { call: RpcCall; methods: string[] } {
  const methods: string[] = [];
  const values: Record<string, unknown> = {
    getblockchaininfo: { chain: 'test', blocks: 500, headers: 500, initialblockdownload: false },
    getwalletinfo: { scanning: false, enhanced_through: 500, unlocked_until: 0 },
    getaddressinfo: { address, ismine: true, isvalid_orchard: true, receiver_types: ['orchard'], receivers_consistent: true, diversifier_index: '42' },
    z_listtransactions: history,
    ...overrides,
  };
  return { methods, call: async <T>(method: string) => { methods.push(method); return values[method] as T; } };
}

test('prepares but never executes the wallet-mutating derivation operation', () => {
  assert.equal(WALLET_B_ADDRESS_ALLOCATION_PLAN.rpcMethodRequiringOperatorApproval, 'z_getaddressforaccount');
  assert.deepEqual(WALLET_B_ADDRESS_ALLOCATION_PLAN.receiverTypes, ['orchard']);
  assert.equal(WALLET_B_ADDRESS_ALLOCATION_PLAN.mutationEnabled, false);
});

test('validates a fresh owned Orchard-only address and records a future-height boundary', async () => {
  const mock = rpc();
  const result = await validateUnusedWalletBAddress(address, { rpc: mock.call, allocationId: 'allocation-1', now: 1_900_000_000_000 });
  assert.equal(result.diversifierIndex, '42');
  assert.equal(result.sourceNotBeforeHeight, 501);
  assert.equal(result.state, 'AVAILABLE');
  assert.equal(mock.methods.includes('getnewaddress'), false);
  assert.equal(mock.methods.includes('z_getaddressforaccount'), false);
});

test('rejects prior history, wrong ownership, wrong pool shape and unlocked wallet', async () => {
  await assert.rejects(validateUnusedWalletBAddress(address, { rpc: rpc([{ address, diversifier_index: '42' }]).call }), /prior wallet history/);
  await assert.rejects(validateUnusedWalletBAddress(address, { rpc: rpc([], { getaddressinfo: { address, ismine: false, isvalid_orchard: true, receiver_types: ['orchard'], receivers_consistent: true, diversifier_index: '42' } }).call }), /not an owned/);
  await assert.rejects(validateUnusedWalletBAddress(address, { rpc: rpc([], { getaddressinfo: { address, ismine: true, isvalid_orchard: true, receiver_types: ['orchard', 'p2pkh'], receivers_consistent: true, diversifier_index: '42' } }).call }), /Orchard-only/);
  await assert.rejects(validateUnusedWalletBAddress(address, { rpc: rpc([], { getwalletinfo: { scanning: false, enhanced_through: 500, unlocked_until: Math.floor(Date.now() / 1000) + 60 } }).call }), /locked/);
});
