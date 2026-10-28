export const DEFAULT_SHIELDED_PAYMENT_WINDOW_MINUTES = 30;
export const MIN_SHIELDED_PAYMENT_WINDOW_MINUTES = 10;
export const MAX_SHIELDED_PAYMENT_WINDOW_MINUTES = 240;

export type SettlementDeadlinePolicy = Readonly<{ shieldedPaymentWindowMs: number }>;

export function settlementDeadlinePolicy(value = process.env.ZECATHON_SHIELDED_PAYMENT_WINDOW_MINUTES): SettlementDeadlinePolicy {
  const minutes = Number(value ?? DEFAULT_SHIELDED_PAYMENT_WINDOW_MINUTES);
  if (!Number.isSafeInteger(minutes) || minutes < MIN_SHIELDED_PAYMENT_WINDOW_MINUTES || minutes > MAX_SHIELDED_PAYMENT_WINDOW_MINUTES) {
    throw new Error(`ZECATHON_SHIELDED_PAYMENT_WINDOW_MINUTES must be an integer from ${MIN_SHIELDED_PAYMENT_WINDOW_MINUTES} to ${MAX_SHIELDED_PAYMENT_WINDOW_MINUTES}.`);
  }
  return Object.freeze({ shieldedPaymentWindowMs: minutes * 60_000 });
}
