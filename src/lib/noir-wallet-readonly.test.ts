import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectNoirWalletReadOnly } from './noir-wallet-readonly.ts';

test('Noir compatibility probe detects without connecting', async () => {
  assert.equal((await inspectNoirWalletReadOnly(undefined)).code, 'NOT_DETECTED');
  const methods: string[] = [];
  const result = await inspectNoirWalletReadOnly({
    isNoirWallet: true,
    zcash: { request: async ({ method }) => { methods.push(method); return null; } },
  });
  assert.equal(result.code, 'NO_ACCOUNT');
  assert.deepEqual(methods, ['zcash_getAccounts']);
});

test('Noir authorized accounts remain blocked without network and pool attestation', async () => {
  const methods: string[] = [];
  const result = await inspectNoirWalletReadOnly({
    isNoirWallet: true,
    zcash: { request: async ({ method }) => {
      methods.push(method);
      return { transparent: 'tmTestOnly', shielded: 'utestTestOnly', accounts: [] };
    } },
  });
  assert.equal(result.ready, false);
  assert.equal(result.code, 'UNSUPPORTED_ADAPTER');
  assert.match(result.message, /testnet build and Ironwood pool/);
  assert.deepEqual(methods, ['zcash_getAccounts']);
  assert.ok(!methods.some(method => /requestAccounts|Balance|Addresses|MaxTransfer|sign|send|shield|disconnect/i.test(method)));
});

test('Noir malformed responses and provider failures fail closed', async () => {
  const malformed = await inspectNoirWalletReadOnly({ isNoirWallet: true, zcash: { request: async () => ({ accounts: [] }) } });
  assert.equal(malformed.code, 'UNSUPPORTED_ADAPTER');
  const unavailable = await inspectNoirWalletReadOnly({ isNoirWallet: true, zcash: { request: async () => { throw new Error('locked'); } } });
  assert.equal(unavailable.code, 'UNAVAILABLE');
});
