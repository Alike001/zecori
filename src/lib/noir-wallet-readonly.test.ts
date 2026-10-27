import assert from 'node:assert/strict';
import test from 'node:test';
import type { NoirWalletProvider, ZcashBalanceResult, ZcashConnectResult } from '@noir-wallet/sdk';
import { detectOfficialNoirWallet, expireNoirReadiness, inspectNoirWallet, subscribeToNoirAccountChanges } from './noir-wallet-readonly.ts';

const connection: ZcashConnectResult = {
  transparent: 'transparent-private-browser-data', shielded: 'shielded-private-browser-data',
  accounts: [{ id: 'wallet:account', label: 'Test account', walletId: 'wallet', accountId: 'account', addresses: { transparent: 't-private', shielded: 'u-private' } }],
};

function balance(overrides: Partial<ZcashBalanceResult> = {}): ZcashBalanceResult {
  const primary = { transparent: '0', shielded: '0.02', total: '0.025', available: '0.02', spendable: '0.02', ...overrides };
  return { ...primary, accounts: [{ id: 'wallet:account', walletId: 'wallet', accountId: 'account', synced: true, balance: primary }] };
}

function wallet(options: { version?: string; accounts?: ZcashConnectResult | null; balance?: ZcashBalanceResult; connectError?: unknown; calls?: string[]; listeners?: Map<string, (...args: unknown[]) => void> } = {}): NoirWalletProvider {
  const calls = options.calls ?? [];
  return {
    isNoirWallet: true, ...(options.version === undefined ? { version: '1.0.40' } : { version: options.version }),
    zcash: {
      connect: async () => { calls.push('connect'); if (options.connectError) throw options.connectError; return options.accounts ?? connection; },
      getAccounts: async () => { calls.push('getAccounts'); return options.accounts === undefined ? connection : options.accounts; },
      getBalance: async () => { calls.push('getBalance'); return options.balance ?? balance(); },
      on: (event: string, handler: (...args: unknown[]) => void) => { calls.push(`on:${event}`); options.listeners?.set(event, handler); },
      removeListener: (event: string) => { calls.push(`remove:${event}`); options.listeners?.delete(event); },
    },
  } as unknown as NoirWalletProvider;
}

test('detects only the official SDK provider and reports a missing extension', async () => {
  const absent = await detectOfficialNoirWallet(0, { getWallet: () => null, detect: async () => { throw new Error('missing'); } });
  assert.equal(absent, null);
  assert.equal((await inspectNoirWallet(absent, 'silent', 100)).code, 'NOT_DETECTED');
  const installed = wallet();
  assert.equal(await detectOfficialNoirWallet(0, { getWallet: () => installed, detect: async () => undefined }), installed);
});

test('silent restore never requests authorization and reads balance only for a previous authorization', async () => {
  const calls: string[] = [];
  const none = await inspectNoirWallet(wallet({ accounts: null, calls }), 'silent', 100);
  assert.equal(none.code, 'NO_ACCOUNT');
  assert.deepEqual(calls, ['getAccounts']);
  calls.length = 0;
  const restored = await inspectNoirWallet(wallet({ calls }), 'silent', 100);
  assert.equal(restored.code, 'UNSUPPORTED_CONFIGURATION');
  assert.deepEqual(calls, ['getAccounts', 'getBalance']);
  assert.equal(restored.balance?.shielded, '0.02');
  assert.equal(restored.balance?.available, '0.02');
  assert.equal(restored.balance?.pending, '0.005');
  assert.ok(!calls.some(method => /connect|send|sign|shield|address/i.test(method)));
});

test('explicit connect handles rejected authorization without reading a balance', async () => {
  const calls: string[] = [];
  const result = await inspectNoirWallet(wallet({ calls, connectError: Object.assign(new Error('User rejected'), { code: 4001 }) }), 'interactive', 100);
  assert.equal(result.code, 'AUTHORIZATION_REJECTED');
  assert.deepEqual(calls, ['connect']);
});

test('wrong builds and insufficient shielded or available balances fail closed', async () => {
  const wrong = await inspectNoirWallet(wallet({ version: '1.0.39' }), 'interactive', 100);
  assert.equal(wrong.code, 'WRONG_BUILD');
  assert.equal(wrong.compatibility.network, 'unverified');
  assert.equal(wrong.compatibility.pool, 'unverified');
  const insufficientShielded = await inspectNoirWallet(wallet({ balance: balance({ shielded: '0.009', available: '1' }) }), 'interactive', 100);
  assert.equal(insufficientShielded.code, 'INSUFFICIENT_FUNDS');
  assert.equal(insufficientShielded.balance?.status, 'insufficient');
  const insufficientAvailable = await inspectNoirWallet(wallet({ balance: balance({ shielded: '1', available: '0.009' }) }), 'interactive', 100);
  assert.equal(insufficientAvailable.code, 'INSUFFICIENT_FUNDS');
});

test('a compatible version remains unsupported without testnet and Ironwood attestation', async () => {
  const result = await inspectNoirWallet(wallet(), 'interactive', 100);
  assert.equal(result.ready, false);
  assert.equal(result.code, 'UNSUPPORTED_CONFIGURATION');
  assert.match(result.message, /cannot attest.*official testnet.*Ironwood/i);
});

test('wallet account or chain switching invalidates and stale readiness expires', async () => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const provider = wallet({ listeners });
  let invalidations = 0;
  const unsubscribe = subscribeToNoirAccountChanges(provider, () => { invalidations += 1; });
  listeners.get('accountsChanged')?.([]);
  listeners.get('chainChanged')?.({ chainId: 'test' });
  assert.equal(invalidations, 2);
  unsubscribe();
  assert.equal(listeners.size, 0);
  const readiness = await inspectNoirWallet(provider, 'silent', 100);
  assert.equal(expireNoirReadiness(readiness, 30_100).code, readiness.code);
  assert.equal(expireNoirReadiness(readiness, 30_101).code, 'STALE');
});
