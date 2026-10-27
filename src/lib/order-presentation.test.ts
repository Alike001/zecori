import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentInstructionsAreActionable } from './order-presentation.ts';
import type { PublicOrderRequest } from './order-api.ts';

test('payment instructions are actionable only during the verified payment window', () => {
  const statuses: PublicOrderRequest['status'][] = [
    'AWAITING_OPERATOR', 'ACCEPTED', 'PAYMENT_READY', 'SOURCE_DETECTED', 'SOURCE_CONFIRMED',
    'PAYOUT_AWAITING_APPROVAL', 'PAYOUT_SUBMITTED', 'COMPLETED', 'FAILED', 'REFUND_PENDING',
    'REFUNDED', 'UNRESOLVED', 'EXPIRED', 'CANCELLED',
  ];
  assert.deepEqual(statuses.filter(paymentInstructionsAreActionable), ['PAYMENT_READY']);
});
