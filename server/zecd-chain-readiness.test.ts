import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFreshTestnetZecdChain } from './zecd-chain-readiness.ts';

const now = 1_900_000_000_000;
const healthy = {
  chain: 'test', blocks: 500, headers: 500, initialblockdownload: false,
  bestblockhash: 'a'.repeat(64), time: 1_899_999_940, warnings: '',
};

test('accepts a fresh exact Zcash testnet tip', () => {
  assert.doesNotThrow(() => assertFreshTestnetZecdChain(healthy, now));
});

test('rejects stale, wrong-chain, ambiguous, refused, and future tips', () => {
  assert.throws(() => assertFreshTestnetZecdChain({ ...healthy, time: 1_899_998_000 }, now), /stale/);
  assert.throws(() => assertFreshTestnetZecdChain({ ...healthy, chain: 'main' }, now), /not on Zcash testnet/);
  assert.throws(() => assertFreshTestnetZecdChain({ ...healthy, headers: 501 }, now), /not fully synchronized/);
  assert.throws(() => assertFreshTestnetZecdChain({ ...healthy, bestblockhash: '' }, now), /identity is unavailable/);
  assert.throws(() => assertFreshTestnetZecdChain({ ...healthy, warnings: 'upstream refused NU7' }, now), /refusal or warning/);
  assert.throws(() => assertFreshTestnetZecdChain({ ...healthy, time: 1_900_000_301 }, now), /ahead of the verifier clock/);
});
