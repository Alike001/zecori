import type { PublicOrderRequest } from './order-api.ts';
import { paymentInstructionsAreActionable } from './order-presentation.ts';

export const PAYMENT_READY_QR_FORMAT = 'exact-shielded-receiver-v1' as const;

export type PaymentReadyInstructions = Readonly<{
  orderId: string;
  receiver: string;
  qrPayload: string;
  qrFormat: typeof PAYMENT_READY_QR_FORMAT;
  sourceNetwork: 'zcash-testnet';
  sourcePool: 'ironwood';
  sourceAmount: '0.01';
  sourceAmountZatoshis: '1000000';
  destinationNetwork: 'base-sepolia';
  destinationChainId: 84532;
  destinationAsset: 'USDC';
  destinationContract: string;
  destinationAmountAtomic: '1000000';
  destinationRecipient: string;
  providerId: string;
  expiresAt: string;
}>;

/**
 * Turns an owner-scoped PAYMENT_READY response into exact display/copy/QR data.
 * The QR intentionally encodes only the receiver verbatim: no wallet URI format
 * has been accepted as compatible, and the amount remains an independently
 * reviewed immutable term on screen.
 */
export function preparePaymentReadyInstructions(request: PublicOrderRequest, now = Date.now()): PaymentReadyInstructions {
  if (!paymentInstructionsAreActionable(request.status) || !request.paymentInstructions || !request.destinationReview) {
    throw new Error('Verified payment instructions are not actionable.');
  }
  const expiry = Date.parse(request.paymentInstructions.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now || request.paymentInstructions.expiresAt !== request.expiresAt) {
    throw new Error('Payment instructions are expired or do not match the immutable order expiry.');
  }
  const { source, destination, provider } = request.terms;
  if (source.network !== 'zcash-testnet' || source.pool !== 'ironwood' || source.amount !== '0.01' || source.amountZatoshis !== '1000000') {
    throw new Error('Source terms do not match the fixed shielded route.');
  }
  if (destination.network !== 'base-sepolia' || destination.chainId !== 84532 || destination.asset !== 'USDC' || destination.amountAtomic !== '1000000') {
    throw new Error('Destination terms do not match the fixed Base Sepolia route.');
  }
  const review = request.destinationReview;
  if (review.network !== destination.network || review.chainId !== destination.chainId || review.asset !== destination.asset
    || review.contract.toLowerCase() !== destination.contract.toLowerCase() || review.amountAtomic !== destination.amountAtomic) {
    throw new Error('Published destination review does not match the immutable order terms.');
  }
  const receiver = request.paymentInstructions.receiver;
  if (!receiver || receiver !== receiver.trim() || /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(receiver)) {
    throw new Error('A clean, exact dedicated shielded receiver is required.');
  }
  return Object.freeze({
    orderId: request.id,
    receiver,
    qrPayload: receiver,
    qrFormat: PAYMENT_READY_QR_FORMAT,
    sourceNetwork: source.network,
    sourcePool: source.pool,
    sourceAmount: source.amount,
    sourceAmountZatoshis: source.amountZatoshis,
    destinationNetwork: destination.network,
    destinationChainId: destination.chainId,
    destinationAsset: destination.asset,
    destinationContract: destination.contract,
    destinationAmountAtomic: destination.amountAtomic,
    destinationRecipient: review.recipient,
    providerId: provider.id,
    expiresAt: request.paymentInstructions.expiresAt,
  });
}

export type ClipboardWriter = { writeText(value: string): Promise<void> };

export async function copyExactReceiver(receiver: string, clipboard: ClipboardWriter | undefined): Promise<void> {
  if (!clipboard) throw new Error('Clipboard access is unavailable. Select and copy the full receiver manually.');
  const value = receiver;
  if (!value || value !== value.trim()) throw new Error('The receiver is not safe to copy.');
  await clipboard.writeText(value);
}

export function recipientFromClipboard(value: string): string {
  if (!value || value !== value.trim()) throw new Error('Clipboard text must contain only the exact address with no surrounding whitespace.');
  if (/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)) throw new Error('Clipboard text contains hidden or control characters. Type or copy the address again.');
  return value;
}

/** Compares the three user-visible transfer channels as UTF-8 bytes. */
export function assertExactReceiverChannels(visibleReceiver: string, clipboardText: string, qrPayload: string): void {
  const encoder = new TextEncoder();
  const expected = encoder.encode(visibleReceiver);
  for (const [label, candidate] of [['clipboard', clipboardText], ['QR payload', qrPayload]] as const) {
    const bytes = encoder.encode(candidate);
    if (bytes.length !== expected.length || bytes.some((value, index) => value !== expected[index])) {
      throw new Error(`${label} does not byte-for-byte match the visible shielded receiver.`);
    }
  }
}
