import test from 'node:test';
import assert from 'node:assert/strict';
import { destinations, isNativeZec, readCatalogue, validZecAmount } from './catalogue.ts';

const zec = { assetId: 'nep141:zec.omft.near', symbol: 'ZEC', blockchain: 'zec', decimals: 8 };
const usdc = { assetId: 'nep141:base-usdc.omft.near', symbol: 'USDC', blockchain: 'base', decimals: 6 };
const sol = { assetId: 'nep141:sol.omft.near', symbol: 'SOL', blockchain: 'sol', decimals: 9 };

test('recognizes native ZEC and not wrapped ZEC', () => {
  assert.equal(isNativeZec(zec), true);
  assert.equal(isNativeZec({ ...zec, blockchain: 'near' }), false);
});

test('requires a native source entry', () => {
  assert.throws(() => readCatalogue({ importedAt: 'now', tokens: [usdc] }), /Native Zcash/);
});

test('rejects invalid metadata rather than displaying invented data', () => {
  assert.throws(() => readCatalogue({ importedAt: 'now', tokens: [zec, { ...sol, decimals: -2 }] }), /Invalid token/);
});

test('deduplicates asset IDs and retains the source', () => {
  const out = readCatalogue({ importedAt: 'now', tokens: [zec, usdc, usdc] });
  assert.equal(out.tokens.length, 2);
});

test('discovery searches by network without treating entries as routes', () => {
  assert.deepEqual(destinations([zec, usdc, sol], 'usd', 'all').map(x => x.symbol), ['USDC']);
  assert.deepEqual(destinations([zec, usdc, sol], '', 'sol').map(x => x.symbol), ['SOL']);
  assert.equal(destinations([zec], '', 'all').length, 0);
});

test('accepts exact-precision ZEC amount only', () => {
  for (const value of ['0.01', '0.00000001', '1', '21000000']) assert.equal(validZecAmount(value), true);
  for (const value of ['0', '-1', '1.123456789', '1e2', 'abc', '21000001', '']) assert.equal(validZecAmount(value), false);
});
