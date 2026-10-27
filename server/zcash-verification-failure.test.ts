import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyZcashVerificationFailure } from './zcash-verification-failure.ts';

test('maps stale and refused upstreams to incomplete sync without synthesizing evidence', () => {
  assert.equal(classifyZcashVerificationFailure(new Error('zecd chain tip is stale')), 'SYNC_INCOMPLETE');
  assert.equal(classifyZcashVerificationFailure(new Error('zecd upstream reports a refusal or warning')), 'SYNC_INCOMPLETE');
  assert.equal(classifyZcashVerificationFailure(new Error('RPC request timed out')), 'RPC_UNAVAILABLE');
});

test('keeps false, missing, and reorged evidence distinguishable', () => {
  assert.equal(classifyZcashVerificationFailure(new Error('Exactly one matching incoming Ironwood output is required')), 'EVIDENCE_AMBIGUOUS');
  assert.equal(classifyZcashVerificationFailure(new Error('Transaction not found')), 'NOT_FOUND');
  assert.equal(classifyZcashVerificationFailure(new Error('Zcash transaction block is not canonical')), 'REORG_DETECTED');
});
