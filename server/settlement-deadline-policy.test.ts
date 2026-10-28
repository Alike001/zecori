import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SHIELDED_PAYMENT_WINDOW_MINUTES, settlementDeadlinePolicy } from './settlement-deadline-policy.ts';

test('shielded payment deadline policy is bounded, explicit, and defaults conservatively', () => {
  assert.equal(settlementDeadlinePolicy(undefined).shieldedPaymentWindowMs, DEFAULT_SHIELDED_PAYMENT_WINDOW_MINUTES * 60_000);
  assert.equal(settlementDeadlinePolicy('45').shieldedPaymentWindowMs, 45 * 60_000);
  for (const invalid of ['9', '241', '30.5', 'not-a-number']) assert.throws(() => settlementDeadlinePolicy(invalid), /integer from 10 to 240/);
});
