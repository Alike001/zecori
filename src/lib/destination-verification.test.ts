import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import { assertLocalDestinationSigner } from './destination-verification.ts';

const account = privateKeyToAccount(`0x${'21'.repeat(32)}`);
const typedData = {
  domain: { name: 'Zecori Destination Control', version: '1', chainId: 84532 },
  types: { DestinationControl: [{ name: 'recipient', type: 'address' }] },
  primaryType: 'DestinationControl',
  message: { recipient: account.address },
} as const;

test('local EIP-712 recovery accepts the exact EOA and rejects a signer mismatch', async () => {
  const signature = await account.signTypedData(typedData);
  await assert.doesNotReject(assertLocalDestinationSigner(typedData, signature, account.address));
  await assert.doesNotReject(assertLocalDestinationSigner(typedData, signature, account.address.toLowerCase()));
  await assert.rejects(assertLocalDestinationSigner(typedData, signature, `0x${'44'.repeat(20)}`), /does not match/);
  await assert.rejects(assertLocalDestinationSigner(typedData, signature, 'not-an-address'), /invalid/);
});

test('local EIP-712 recovery fails safely for malformed signatures', async () => {
  await assert.rejects(assertLocalDestinationSigner(typedData, '0x1234', account.address), /could not be checked locally/);
});
