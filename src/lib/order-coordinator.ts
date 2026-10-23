export type OrderStatus =
  | 'CREATED'
  | 'AWAITING_PAYMENT'
  | 'SOURCE_DETECTED'
  | 'SOURCE_CONFIRMED'
  | 'PAYOUT_AWAITING_APPROVAL'
  | 'PAYOUT_SUBMITTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'UNRESOLVED';

export const BASE_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export const TRUSTED_PROVIDER_ID = 'zecathon-testnet-lp-01';
export const ROUTE_PROVIDERS = Object.freeze({
  [TRUSTED_PROVIDER_ID]: {
    id: TRUSTED_PROVIDER_ID,
    model: 'trusted-liquidity-provider' as const,
    sourceVerifier: 'zcash-rpc-adapter' as const,
    destinationVerifier: 'base-rpc-adapter' as const,
    custodyDisclosure: 'The testnet liquidity provider temporarily controls received TAZ and manually authorizes any Base Sepolia test-USDC payout.',
  },
});

export function routeProvider(providerId: string = TRUSTED_PROVIDER_ID) {
  const provider = (ROUTE_PROVIDERS as Record<string, (typeof ROUTE_PROVIDERS)[typeof TRUSTED_PROVIDER_ID] | undefined>)[providerId];
  if (!provider) throw new Error('Route provider is not registered for independent verification');
  return provider;
}
export const FIXED_RATE = {
  description: 'Experimental fixed test rate: 1 TAZ = 100 test USDC; this is not a live market quote.',
  sourceAtomicUnits: '100000000',
  destinationAtomicUnits: '100000000',
} as const;

export type ReceiptLink = {
  transactionId: string;
  verifiedAt: string;
  verification: 'independent';
  verifier: 'zcash-rpc-adapter' | 'base-rpc-adapter';
};

export type SourceReceiptLink = ReceiptLink & {
  amountZatoshis: string;
  outputIndex: number;
  diversifierIndex: string;
  blockHeight: number;
  blockHash: string;
  blockTime: number;
  confirmations: number;
};

export type DestinationReceiptLink = ReceiptLink & { amountAtomic: string };

export type ReceivingAddressBinding = {
  allocationId: string;
  sourceReceiver: string;
  sourceDiversifierIndex: string;
  sourceNotBeforeHeight: number;
};

export type PayoutAuthorization = {
  state: 'NOT_REQUESTED' | 'AWAITING_APPROVAL' | 'APPROVED' | 'CONSUMED';
  approvedAt?: string;
  approvedBy?: string;
  authorizationId?: string;
  consumedAt?: string;
};

export type PaymentOrder = ReceivingAddressBinding & {
  id: string;
  createdAt: string;
  status: OrderStatus;
  sourceNetwork: 'zcash-testnet';
  sourceAsset: 'TAZ';
  sourcePool: 'ironwood';
  sourceAmountZat: string;
  amount: string;
  destinationNetwork: 'base-sepolia';
  destinationChainId: 84532;
  destinationRecipient: string;
  destinationAmountAtomic: string;
  destinationAsset: { symbol: 'USDC'; contract: typeof BASE_USDC; decimals: 6; classification: 'Circle test token' };
  fixedRate: typeof FIXED_RATE;
  expiresAt: string;
  sourceMinimumConfirmations: 10;
  destinationMinimumConfirmations: 3;
  provider: {
    id: string;
    model: 'trusted-liquidity-provider';
    custodyDisclosure: string;
  };
  refundPolicy: {
    paymentTimeout: string;
    latePayment: string;
    reorganization: string;
    uncertainBroadcast: string;
  };
  payoutAuthorization: PayoutAuthorization;
  sourceReceipt?: SourceReceiptLink;
  destinationReceipt?: DestinationReceiptLink;
  payoutTransactionId?: string;
  finalReceiptId?: string;
  resolutionReason?: string;
};

export type CreateOrderInput = {
  allocationId: string;
  destinationRecipient: string;
  sourceAmountZat: string;
  expiresAt: string;
  providerId?: string;
};

const FULL_HEX_TX = /^0x[0-9a-f]{64}$/i;
const FULL_EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;

function nonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('…') || value.includes('...')) throw new Error(`${label} must be complete`);
  return value.trim();
}

export function isFullTransactionId(value: string): boolean {
  return FULL_HEX_TX.test(value) || /^[0-9a-f]{64}$/i.test(value);
}

export function isFullEvmAddress(value: string): boolean {
  return FULL_EVM_ADDRESS.test(value);
}

export function zatoshisToZec(value: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error('Source amount must be positive integer zatoshis');
  const amount = BigInt(value);
  return `${amount / 100_000_000n}.${(amount % 100_000_000n).toString().padStart(8, '0')}`.replace(/\.?0+$/, '');
}

export function destinationAmountFor(sourceAmountZat: string): string {
  const product = BigInt(sourceAmountZat) * BigInt(FIXED_RATE.destinationAtomicUnits);
  const denominator = BigInt(FIXED_RATE.sourceAtomicUnits);
  if (product % denominator !== 0n) throw new Error('Source amount cannot be represented exactly at the fixed test rate');
  return (product / denominator).toString();
}

export function createOrder(input: CreateOrderInput, binding: ReceivingAddressBinding, now = Date.now(), id: string = crypto.randomUUID()): PaymentOrder {
  const allocationId = nonEmpty(input.allocationId, 'Allocation ID');
  if (allocationId !== binding.allocationId) throw new Error('Receiving allocation does not match the order');
  const destinationRecipient = nonEmpty(input.destinationRecipient, 'Destination recipient');
  if (!isFullEvmAddress(destinationRecipient)) throw new Error('Destination recipient must be a complete Base address');
  const sourceAmountZat = nonEmpty(input.sourceAmountZat, 'Source amount');
  const amount = zatoshisToZec(sourceAmountZat);
  const destinationAmountAtomic = destinationAmountFor(sourceAmountZat);
  const provider = routeProvider(input.providerId);
  if (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= now) throw new Error('Order expiry must be in the future');
  if (!/^utest1[a-z0-9]+$/.test(binding.sourceReceiver) || !/^\d+$/.test(binding.sourceDiversifierIndex)) throw new Error('Receiving allocation is invalid');
  if (!Number.isSafeInteger(binding.sourceNotBeforeHeight) || binding.sourceNotBeforeHeight <= 0) throw new Error('Receiving allocation height is invalid');
  if (!id || id.length < 10) throw new Error('Order ID is invalid');
  return {
    ...binding, id, createdAt: new Date(now).toISOString(), status: 'CREATED',
    sourceNetwork: 'zcash-testnet', sourceAsset: 'TAZ', sourcePool: 'ironwood', sourceAmountZat, amount,
    destinationNetwork: 'base-sepolia', destinationChainId: 84532, destinationRecipient, destinationAmountAtomic,
    destinationAsset: { symbol: 'USDC', contract: BASE_USDC, decimals: 6, classification: 'Circle test token' },
    fixedRate: FIXED_RATE, expiresAt: new Date(Date.parse(input.expiresAt)).toISOString(),
    sourceMinimumConfirmations: 10, destinationMinimumConfirmations: 3,
    provider: {
      id: provider.id, model: provider.model, custodyDisclosure: provider.custodyDisclosure,
    },
    refundPolicy: {
      paymentTimeout: 'No payment detected by expiry: fail the order; no payout is authorized.',
      latePayment: 'A payment first detected after expiry is never paid out automatically and enters REFUND_PENDING for manual review.',
      reorganization: 'Loss of canonical source or payout evidence enters UNRESOLVED; completion is forbidden until independently reconciled.',
      uncertainBroadcast: 'An ambiguous manually submitted payout remains UNRESOLVED and must never be automatically retried.',
    },
    payoutAuthorization: { state: 'NOT_REQUESTED' },
  };
}

export function activateOrder(order: PaymentOrder, now = Date.now()): PaymentOrder {
  if (order.status !== 'CREATED') throw new Error('Only a created order can be activated');
  if (Date.parse(order.expiresAt) <= now) return { ...order, status: 'FAILED', resolutionReason: 'expired-before-activation' };
  return { ...order, status: 'AWAITING_PAYMENT' };
}

export function attachSourceEvidence(order: PaymentOrder, receipt: SourceReceiptLink, now = Date.now()): PaymentOrder {
  if (order.status !== 'AWAITING_PAYMENT') throw new Error('Order is not awaiting source payment');
  if (order.sourceReceipt) throw new Error('Source evidence is already linked');
  if (receipt.amountZatoshis !== order.sourceAmountZat || receipt.diversifierIndex !== order.sourceDiversifierIndex || receipt.blockHeight < order.sourceNotBeforeHeight || receipt.blockTime < Math.floor(Date.parse(order.createdAt) / 1000)) throw new Error('Source evidence does not match immutable order terms');
  if (Date.parse(order.expiresAt) < now) return { ...order, sourceReceipt: receipt, status: 'REFUND_PENDING', resolutionReason: 'late-source-payment' };
  return { ...order, sourceReceipt: receipt, status: receipt.confirmations >= order.sourceMinimumConfirmations ? 'SOURCE_CONFIRMED' : 'SOURCE_DETECTED' };
}

export function confirmSourceEvidence(order: PaymentOrder, receipt: SourceReceiptLink): PaymentOrder {
  if (order.status !== 'SOURCE_DETECTED' || !order.sourceReceipt) throw new Error('Detected source evidence is required');
  if (receipt.transactionId !== order.sourceReceipt.transactionId || receipt.outputIndex !== order.sourceReceipt.outputIndex) throw new Error('Confirmation does not match detected source output');
  if (receipt.confirmations < order.sourceMinimumConfirmations) throw new Error('Source payment lacks required confirmations');
  return { ...order, sourceReceipt: receipt, status: 'SOURCE_CONFIRMED' };
}

export function queuePayoutApproval(order: PaymentOrder): PaymentOrder {
  if (order.status !== 'SOURCE_CONFIRMED') throw new Error('Confirmed source payment is required before payout approval');
  if (order.payoutAuthorization.state !== 'NOT_REQUESTED') throw new Error('Payout authorization has already been requested');
  return { ...order, status: 'PAYOUT_AWAITING_APPROVAL', payoutAuthorization: { state: 'AWAITING_APPROVAL' } };
}

export function authorizePayout(order: PaymentOrder, approvedBy: string, authorizationId: string, now = Date.now()): PaymentOrder {
  if (order.status !== 'PAYOUT_AWAITING_APPROVAL' || order.payoutAuthorization.state !== 'AWAITING_APPROVAL') throw new Error('Payout is not awaiting approval');
  if (!approvedBy.trim() || !authorizationId.trim()) throw new Error('Manual operator identity and authorization ID are required');
  return { ...order, payoutAuthorization: { state: 'APPROVED', approvedBy, authorizationId, approvedAt: new Date(now).toISOString() } };
}

export function recordPayoutSubmission(order: PaymentOrder, transactionId: string, now = Date.now()): PaymentOrder {
  if (order.status !== 'PAYOUT_AWAITING_APPROVAL' || order.payoutAuthorization.state !== 'APPROVED') throw new Error('One-time payout approval is required');
  if (!FULL_HEX_TX.test(transactionId)) throw new Error('Complete Base payout transaction ID is required');
  return { ...order, status: 'PAYOUT_SUBMITTED', payoutTransactionId: transactionId.toLowerCase(), payoutAuthorization: { ...order.payoutAuthorization, state: 'CONSUMED', consumedAt: new Date(now).toISOString() } };
}

export function attachDestinationEvidence(order: PaymentOrder, receipt: DestinationReceiptLink): PaymentOrder {
  if (order.status !== 'PAYOUT_SUBMITTED' || order.payoutAuthorization.state !== 'CONSUMED') throw new Error('A manually approved payout must be submitted first');
  if (order.destinationReceipt) throw new Error('Destination evidence is already linked');
  if (receipt.transactionId !== order.payoutTransactionId || receipt.amountAtomic !== order.destinationAmountAtomic) throw new Error('Destination evidence does not match the authorized payout');
  return { ...order, destinationReceipt: receipt };
}

export function completeOrder(order: PaymentOrder, finalReceiptId: string): PaymentOrder {
  if (order.status !== 'PAYOUT_SUBMITTED' || !order.sourceReceipt || !order.destinationReceipt) throw new Error('Both independently verified sides of this order are required');
  if (!finalReceiptId) throw new Error('Final receipt ID is required');
  return { ...order, finalReceiptId, status: 'COMPLETED' };
}

export function expireOrder(order: PaymentOrder, now = Date.now()): PaymentOrder {
  if (Date.parse(order.expiresAt) > now) throw new Error('Order has not expired');
  if (order.status === 'AWAITING_PAYMENT' || order.status === 'CREATED') return { ...order, status: 'FAILED', resolutionReason: 'payment-timeout' };
  if (order.status === 'SOURCE_DETECTED' || order.status === 'SOURCE_CONFIRMED') return { ...order, status: 'REFUND_PENDING', resolutionReason: 'expired-with-source-funds' };
  throw new Error('Order cannot be expired from its current state');
}

export function markUnresolved(order: PaymentOrder, reason = 'manual-reconciliation-required'): PaymentOrder {
  if (order.status === 'COMPLETED' || order.status === 'REFUNDED') throw new Error('A settled order cannot become unresolved');
  return { ...order, status: 'UNRESOLVED', resolutionReason: reason };
}

export function markRefundPending(order: PaymentOrder, reason = 'manual-refund-required'): PaymentOrder {
  if (!order.sourceReceipt || !['SOURCE_DETECTED', 'SOURCE_CONFIRMED', 'UNRESOLVED', 'FAILED'].includes(order.status)) throw new Error('Refund requires received source funds');
  return { ...order, status: 'REFUND_PENDING', resolutionReason: reason };
}

export function markRefunded(order: PaymentOrder, independentlyVerified: boolean): PaymentOrder {
  if (order.status !== 'REFUND_PENDING') throw new Error('Refund is not pending');
  if (!independentlyVerified) throw new Error('Refund requires independent verification');
  return { ...order, status: 'REFUNDED' };
}

export function displayOrderStatus(status: OrderStatus): string {
  return status.split('_').map(word => `${word[0]}${word.slice(1).toLowerCase()}`).join(' ');
}

export function receiptKey(chain: 'zcash' | 'base', transactionId: string, outputIndex?: number): string {
  return `${chain}:${transactionId.toLowerCase()}${outputIndex === undefined ? '' : `:${outputIndex}`}`;
}
