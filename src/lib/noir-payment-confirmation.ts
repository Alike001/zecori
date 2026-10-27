import type { PublicOrderRequest } from './order-api.ts';
import { preparePaymentReadyInstructions } from './payment-ready.ts';

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
  const instructions = preparePaymentReadyInstructions(request, now);
  const immutableTerms = Object.freeze({
    sourceNetwork: instructions.sourceNetwork, sourcePool: instructions.sourcePool,
    destinationNetwork: instructions.destinationNetwork, destinationChainId: instructions.destinationChainId,
    destinationAsset: instructions.destinationAsset, destinationAmountAtomic: instructions.destinationAmountAtomic,
    destinationRecipient: instructions.destinationRecipient, providerId: instructions.providerId,
  });
  const futureSendRequest = Object.freeze({ to: instructions.receiver, amount: instructions.sourceAmount, fundingSource: 'shielded' as const });
  return Object.freeze({
    version: 'zecori-noir-payment-confirmation-v1', orderId: request.id, routeId: 'zcash-testnet-to-base-sepolia-fixed',
    exactAmount: instructions.sourceAmount, amountZatoshis: instructions.sourceAmountZatoshis,
    dedicatedShieldedReceiver: instructions.receiver, expiresAt: instructions.expiresAt,
    immutableTerms, futureSendRequest, sendingEnabled: false,
  });
}
