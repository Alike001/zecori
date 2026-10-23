import { BASE_USDC, isFullEvmAddress, isFullTransactionId, type PaymentOrder } from './order-coordinator.ts';

export type VerificationResult =
  | { outcome: 'verified'; transactionId: string; verifiedAt: string; verification: 'independent'; verifier: 'zcash-rpc-adapter' | 'base-rpc-adapter' }
  | { outcome: 'rejected' | 'uncertain'; reason: string };

export type ZcashShieldedReceipt = {
  orderId: string;
  transactionId: string;
  network: 'zcash-testnet';
  receiver: string;
  amount: string;
  amountZatoshis: string;
  pool: 'ironwood';
  status: 'mined';
  confirmations: number;
  blockHeight: number;
  blockHash: string;
  blockTime: number;
  outputIndex: number;
  diversifierIndex: string;
  shielded: true;
  independentlyVerified: true;
};

export type BaseSepoliaErc20Receipt = {
  orderId: string;
  transactionId: string;
  chainId: 84532;
  tokenContract: string;
  recipient: string;
  amountAtomic: string;
  independentlyVerified: true;
};

function verified(transactionId: string, verifier: 'zcash-rpc-adapter' | 'base-rpc-adapter'): VerificationResult {
  return { outcome: 'verified', transactionId, verifiedAt: new Date().toISOString(), verification: 'independent', verifier };
}

export function verifyZcashShieldedReceipt(order: PaymentOrder, receipt: ZcashShieldedReceipt): VerificationResult {
  if (receipt.orderId !== order.id) return { outcome: 'rejected', reason: 'Receipt is bound to a different order' };
  if (!isFullTransactionId(receipt.transactionId)) return { outcome: 'rejected', reason: 'Zcash transaction ID must be complete' };
  if (receipt.network !== order.sourceNetwork || receipt.receiver !== order.sourceReceiver) return { outcome: 'rejected', reason: 'Zcash network or full receiver does not match fixed terms' };
  if (receipt.amount !== order.amount || receipt.amountZatoshis !== order.sourceAmountZat || receipt.pool !== order.sourcePool || receipt.status !== 'mined') return { outcome: 'rejected', reason: 'Shielded output does not match fixed atomic terms' };
  if (receipt.diversifierIndex !== order.sourceDiversifierIndex || receipt.blockHeight < order.sourceNotBeforeHeight || receipt.blockTime < Math.floor(Date.parse(order.createdAt) / 1000) || !Number.isSafeInteger(receipt.outputIndex) || receipt.outputIndex < 0) return { outcome: 'rejected', reason: 'Shielded output identity does not match the assigned order receiver' };
  if (receipt.shielded !== true || receipt.independentlyVerified !== true) return { outcome: 'uncertain', reason: 'Shielded receipt is not independently verified' };
  return verified(receipt.transactionId, 'zcash-rpc-adapter');
}

export function verifyBaseSepoliaErc20Receipt(order: PaymentOrder, receipt: BaseSepoliaErc20Receipt): VerificationResult {
  if (receipt.orderId !== order.id) return { outcome: 'rejected', reason: 'Receipt is bound to a different order' };
  if (!isFullTransactionId(receipt.transactionId)) return { outcome: 'rejected', reason: 'Base transaction ID must be complete' };
  if (receipt.chainId !== 84532 || receipt.tokenContract.toLowerCase() !== BASE_USDC.toLowerCase()) return { outcome: 'rejected', reason: 'Base Sepolia network or USDC contract does not match fixed terms' };
  if (!isFullEvmAddress(receipt.recipient) || receipt.recipient.toLowerCase() !== order.destinationRecipient.toLowerCase()) return { outcome: 'rejected', reason: 'Full destination recipient does not match fixed terms' };
  if (receipt.amountAtomic !== order.destinationAmountAtomic || receipt.independentlyVerified !== true) return { outcome: 'uncertain', reason: 'ERC-20 amount or independent verification is incomplete' };
  return verified(receipt.transactionId, 'base-rpc-adapter');
}
