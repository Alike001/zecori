import type { DestinationReceiptLink, PaymentOrder, SourceReceiptLink } from './order-coordinator.ts';

export type KnownFee = { asset: string; amount: string };
export type PrivacyClassification = 'shielded-source-private' | 'public-settlement-with-private-correlation';

export type FinalReceipt = {
  receiptId: string;
  kind: 'final';
  orderId: string;
  sourceChain: PaymentOrder['sourceNetwork'];
  destinationChain: PaymentOrder['destinationNetwork'];
  sourceAsset: PaymentOrder['sourceAsset'];
  destinationAsset: PaymentOrder['destinationAsset'];
  verifiedSourceAmount: string;
  verifiedDestinationAmount: string;
  actualKnownFees: KnownFee[];
  sourceSettlementTimestamp: string;
  destinationSettlementTimestamp: string;
  destinationTransactionHash: string;
  sourceTransactionId: string;
  sourceReceiver: string;
  verificationStatus: 'independently-verified';
  privacyClassification: PrivacyClassification;
  printableNotice: 'This is a print-safe research receipt, not a cryptographically authenticated PDF.';
};

export type ShareableReceipt = Omit<FinalReceipt,
  | 'sourceTransactionId'
  | 'destinationTransactionHash'
  | 'sourceReceiver'
  | 'orderId'
  | 'privacyClassification'
  | 'verifiedSourceAmount'
  | 'sourceSettlementTimestamp'
  | 'actualKnownFees'
  | 'sourceChain'
  | 'sourceAsset'
> & {
  orderReference: string;
  privacyClassification: 'redacted-shareable';
  redactions: string[];
};

export function createFinalReceipt(
  order: PaymentOrder,
  source: SourceReceiptLink,
  destination: DestinationReceiptLink,
  receiptId: string,
): FinalReceipt {
  if (order.status !== 'PAYOUT_SUBMITTED' || !order.sourceReceipt || !order.destinationReceipt || order.payoutAuthorization.state !== 'CONSUMED') {
    throw new Error('A final receipt requires independently verified source and destination settlement');
  }
  if (source.transactionId !== order.sourceReceipt.transactionId || destination.transactionId !== order.destinationReceipt.transactionId) {
    throw new Error('Receipt evidence does not match the order links');
  }
  if (source.amountZatoshis !== order.sourceAmountZat || destination.amountAtomic !== order.destinationAmountAtomic) throw new Error('Verified receipt amounts do not match fixed terms');
  const destinationWhole = BigInt(order.destinationAmountAtomic) / 1_000_000n;
  const destinationFraction = (BigInt(order.destinationAmountAtomic) % 1_000_000n).toString().padStart(6, '0');
  const verifiedDestinationAmount = `${destinationWhole}.${destinationFraction}`.replace(/\.?0+$/, '');
  return {
    receiptId, kind: 'final', orderId: order.id, sourceChain: order.sourceNetwork, destinationChain: order.destinationNetwork,
    sourceAsset: order.sourceAsset, destinationAsset: order.destinationAsset, verifiedSourceAmount: order.amount,
    verifiedDestinationAmount, actualKnownFees: [], sourceSettlementTimestamp: source.verifiedAt,
    destinationSettlementTimestamp: destination.verifiedAt, destinationTransactionHash: destination.transactionId,
    sourceTransactionId: source.transactionId, sourceReceiver: order.sourceReceiver,
    verificationStatus: 'independently-verified', privacyClassification: 'shielded-source-private',
    printableNotice: 'This is a print-safe research receipt, not a cryptographically authenticated PDF.',
  };
}

export function toShareableReceipt(receipt: FinalReceipt): ShareableReceipt {
  const {
    sourceTransactionId: _sourceTransactionId,
    destinationTransactionHash: _destinationTransactionHash,
    sourceReceiver: _sourceReceiver,
    orderId: _orderId,
    verifiedSourceAmount: _verifiedSourceAmount,
    sourceSettlementTimestamp: _sourceSettlementTimestamp,
    actualKnownFees: _actualKnownFees,
    sourceChain: _sourceChain,
    sourceAsset: _sourceAsset,
    ...safe
  } = receipt;
  return {
    ...safe,
    orderReference: `order-${receipt.receiptId.slice(0, 8)}`,
    privacyClassification: 'redacted-shareable',
    redactions: [
      'source transaction ID', 'destination transaction ID', 'shielded receiver address',
      'internal order/correlation ID', 'shielded source amount', 'shielded settlement timestamp', 'transaction fees',
      'source chain and asset',
    ],
  };
}
