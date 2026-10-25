import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEvmAddress, toChecksumAddress } from './evm-address.ts';

test('normalizes lower-case EVM addresses to EIP-55', () => {
  assert.equal(toChecksumAddress('0x52908400098527886e0f7030069857d2e4169ee7'), '0x52908400098527886E0F7030069857D2E4169EE7');
  assert.equal(normalizeEvmAddress('0xde709f2102306220921060314715629080e2fb77'), '0xde709f2102306220921060314715629080e2fb77');
});

test('rejects zero, short, and incorrectly checksummed mixed-case addresses', () => {
  assert.throws(() => normalizeEvmAddress(`0x${'0'.repeat(40)}`), /zero/);
  assert.throws(() => normalizeEvmAddress('0x1234'), /20 bytes/);
  assert.throws(() => normalizeEvmAddress('0x52908400098527886E0F7030069857D2E4169Ee7'), /checksum/);
});
