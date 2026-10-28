import assert from 'node:assert/strict';
import test from 'node:test';
import { paymentCountdown } from './payment-countdown.ts';

test('payment countdown reaches expiry without extending its fixed deadline', () => {
  const deadline = '2030-01-01T00:00:00.000Z';
  assert.deepEqual(paymentCountdown(deadline, Date.parse('2029-12-31T23:59:00.001Z')), { expired: false, remainingMs: 59_999, label: '01:00' });
  assert.deepEqual(paymentCountdown(deadline, Date.parse(deadline)), { expired: true, remainingMs: 0, label: 'Expired' });
  assert.equal(deadline, '2030-01-01T00:00:00.000Z');
});
