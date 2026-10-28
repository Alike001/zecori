export type PaymentCountdown = Readonly<{ expired: boolean; remainingMs: number; label: string }>;

export function paymentCountdown(deadline: string, now = Date.now()): PaymentCountdown {
  const deadlineMs = Date.parse(deadline);
  if (!Number.isFinite(deadlineMs)) return Object.freeze({ expired: true, remainingMs: 0, label: 'Expired' });
  const remainingMs = Math.max(0, deadlineMs - now);
  if (remainingMs === 0) return Object.freeze({ expired: true, remainingMs, label: 'Expired' });
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const label = hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return Object.freeze({ expired: false, remainingMs, label });
}
