import { BASE_USDC, isFullEvmAddress, isFullTransactionId } from '../src/lib/order-coordinator.ts';
import type { BaseSepoliaErc20Receipt } from '../src/lib/read-only-verification.ts';
import { jsonRpcClient, type RpcCall } from './rpc-client.ts';

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_SEPOLIA_RPC = 'https://base-sepolia-rpc.publicnode.com';
export const BASE_REFERENCE_TRANSACTION = '0xd8297f03c23141ea01b5095ff789d1cdbaf19abce42fb6244fe5c5a433574f39';
export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

type Log = { address?: string; topics?: string[]; data?: string; removed?: boolean; transactionHash?: string; blockHash?: string };
type TransactionReceipt = { status?: string; blockHash?: string; blockNumber?: string; transactionHash?: string; logs?: Log[] };
type Block = { hash?: string; number?: string; transactions?: Array<string | { hash?: string }> };

export type BaseVerificationRequest = {
  orderId: string;
  transactionId: string;
  recipient: string;
  amountAtomic: string;
  minimumConfirmations?: number;
};

function quantity(value: string | undefined, label: string): bigint {
  if (!value || !/^0x[0-9a-f]+$/i.test(value)) throw new Error(`${label} is not a valid RPC quantity`);
  return BigInt(value);
}

function topicAddress(topic: string | undefined): string | undefined {
  if (!topic || !/^0x[0-9a-f]{64}$/i.test(topic)) return undefined;
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function logAmount(data: string | undefined): bigint | undefined {
  if (!data || !/^0x[0-9a-f]{64}$/i.test(data)) return undefined;
  return BigInt(data);
}

export async function verifyBaseSepoliaTransaction(
  request: BaseVerificationRequest,
  options: { rpc?: RpcCall; allowHistoricalReference?: boolean } = {},
): Promise<BaseSepoliaErc20Receipt> {
  if (!isFullTransactionId(request.transactionId) || !request.transactionId.startsWith('0x')) throw new Error('Base transaction ID must be complete');
  if (!isFullEvmAddress(request.recipient)) throw new Error('Base recipient must be a full address');
  if (!/^(?:0|[1-9]\d*)$/.test(request.amountAtomic)) throw new Error('Base amount must be integer atomic units');
  if (!options.allowHistoricalReference && request.transactionId.toLowerCase() === BASE_REFERENCE_TRANSACTION) {
    throw new Error('Historical reference transaction cannot settle an order');
  }

  const rpc = options.rpc ?? jsonRpcClient(BASE_SEPOLIA_RPC);
  const chainId = quantity(await rpc<string>('eth_chainId'), 'chain ID');
  if (chainId !== BigInt(BASE_SEPOLIA_CHAIN_ID)) throw new Error('RPC is not Base Sepolia');

  const receipt = await rpc<TransactionReceipt | null>('eth_getTransactionReceipt', [request.transactionId]);
  if (!receipt) throw new Error('Transaction receipt is missing');
  if (receipt.status !== '0x1') throw new Error('Transaction did not succeed');
  if (!receipt.blockHash || !receipt.blockNumber) throw new Error('Transaction is not mined');
  if (receipt.transactionHash?.toLowerCase() !== request.transactionId.toLowerCase()) throw new Error('Receipt transaction ID mismatch');

  const [latestHex, canonical] = await Promise.all([
    rpc<string>('eth_blockNumber'),
    rpc<Block | null>('eth_getBlockByNumber', [receipt.blockNumber, false]),
  ]);
  if (!canonical || canonical.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error('Receipt block is not canonical');
  const canonicalTransactions = canonical.transactions ?? [];
  if (!canonicalTransactions.some(tx => (typeof tx === 'string' ? tx : tx.hash)?.toLowerCase() === request.transactionId.toLowerCase())) {
    throw new Error('Transaction is absent from its canonical block');
  }
  const confirmations = quantity(latestHex, 'latest block') - quantity(receipt.blockNumber, 'receipt block') + 1n;
  const minimum = BigInt(request.minimumConfirmations ?? 3);
  if (confirmations < minimum) throw new Error(`Insufficient confirmations: ${confirmations}/${minimum}`);

  const recipient = request.recipient.toLowerCase();
  const amount = BigInt(request.amountAtomic);
  const matching = (receipt.logs ?? []).filter(log =>
    log.removed !== true
    && log.address?.toLowerCase() === BASE_USDC.toLowerCase()
    && log.transactionHash?.toLowerCase() === request.transactionId.toLowerCase()
    && log.blockHash?.toLowerCase() === receipt.blockHash?.toLowerCase()
    && log.topics?.length === 3
    && log.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC
    && topicAddress(log.topics[2]) === recipient
    && logAmount(log.data) === amount
  );
  if (matching.length !== 1) throw new Error('Exactly one matching USDC Transfer output is required');

  return {
    orderId: request.orderId,
    transactionId: request.transactionId.toLowerCase(),
    chainId: BASE_SEPOLIA_CHAIN_ID,
    tokenContract: BASE_USDC,
    recipient: request.recipient,
    amountAtomic: request.amountAtomic,
    independentlyVerified: true,
  };
}
