import type { PublicOrderRequest } from './order-api.ts';
import { paymentInstructionsAreActionable } from './order-presentation.ts';

export type ShieldedFundingSource = 'shielded';

export type PreparedNoirPaymentConfirmation = Readonly<{
  version: 'zecori-noir-payment-confirmation-v1';
  orderId: string;
  routeId: 'zcash-testnet-to-base-sepolia-fixed';
  exactAmount: '0.01';
  amountZatoshis: '1000000';
  dedicatedShieldedReceiver: string;
  expiresAt: string;
  immutableTerms: Readonly<{
    sourceNetwork: 'zcash-testnet'; sourcePool: 'ironwood'; destinationNetwork: 'base-sepolia'; destinationChainId: 84532;
    destinationAsset: 'USDC'; destinationAmountAtomic: '1000000'; destinationRecipient: string; providerId: string;
  }>;
  futureSendRequest: Readonly<{ to: string; amount: '0.01'; fundingSource: ShieldedFundingSource }>;
  sendingEnabled: false;
}>;

/** Prepares review-only data. It deliberately has no wallet argument and cannot send. */
export function prepareNoirPaymentConfirmation(request: PublicOrderRequest, fundingSource: 'shielded' | 'transparent' = 'shielded', now = Date.now()): PreparedNoirPaymentConfirmation {
  if (fundingSource !== 'shielded') throw new Error('Transparent Zcash funding is forbidden for this route.');
  if (!paymentInstructionsAreActionable(request.status) || !request.paymentInstructions || !request.destinationReview) throw new Error('Verified payment instructions are not actionable.');
  const expiresAt = Date.parse(request.paymentInstructions.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now || request.paymentInstructions.expiresAt !== request.expiresAt) throw new Error('Payment instructions are expired or do not match the immutable order expiry.');
  if (request.terms.source.network !== 'zcash-testnet' || request.terms.source.pool !== 'ironwood' || request.terms.source.amountZatoshis !== '1000000' || request.terms.source.amount !== '0.01') throw new Error('Source terms do not match the fixed shielded route.');
  if (request.terms.destination.network !== 'base-sepolia' || request.terms.destination.chainId !== 84532 || request.terms.destination.asset !== 'USDC' || request.terms.destination.amountAtomic !== '1000000') throw new Error('Destination terms do not match the fixed Base Sepolia route.');
  if (!request.paymentInstructions.receiver.trim()) throw new Error('A dedicated shielded receiver is required.');
  const immutableTerms = Object.freeze({
    sourceNetwork: request.terms.source.network, sourcePool: request.terms.source.pool,
    destinationNetwork: request.terms.destination.network, destinationChainId: request.terms.destination.chainId,
    destinationAsset: request.terms.destination.asset, destinationAmountAtomic: request.terms.destination.amountAtomic,
    destinationRecipient: request.destinationReview.recipient, providerId: request.terms.provider.id,
  });
  const futureSendRequest = Object.freeze({ to: request.paymentInstructions.receiver, amount: request.terms.source.amount, fundingSource: 'shielded' as const });
  return Object.freeze({
    version: 'zecori-noir-payment-confirmation-v1', orderId: request.id, routeId: 'zcash-testnet-to-base-sepolia-fixed',
    exactAmount: request.terms.source.amount, amountZatoshis: request.terms.source.amountZatoshis,
    dedicatedShieldedReceiver: request.paymentInstructions.receiver, expiresAt: request.paymentInstructions.expiresAt,
    immutableTerms, futureSendRequest, sendingEnabled: false,
  });
}
