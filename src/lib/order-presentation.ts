import type { PublicOrderRequest } from './order-api.ts';

export function paymentInstructionsAreActionable(status: PublicOrderRequest['status']): boolean {
  return status === 'PAYMENT_READY';
}
