import { BASE_USDC, isFullEvmAddress, isFullTransactionId } from '../src/lib/order-coordinator.ts';
import type { BaseSepoliaErc20Receipt } from '../src/lib/read-only-verification.ts';
import { jsonRpcClient, type RpcCall } from './rpc-client.ts';

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const DEFAULT_BASE_SEPOLIA_RPC = 'https://sepolia.base.org';
export const BASE_SEPOLIA_RPC = DEFAULT_BASE_SEPOLIA_RPC;
export const BASE_RPC_TIMEOUT_MS = 6_000;
export const BASE_REFERENCE_TRANSACTION = '0xd8297f03c23141ea01b5095ff789d1cdbaf19abce42fb6244fe5c5a433574f39';
export const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

type Log = { address?: string; topics?: string[]; data?: string; removed?: boolean; transactionHash?: string; blockHash?: string };
type TransactionReceipt = { status?: string; blockHash?: string; blockNumber?: string; transactionHash?: string; logs?: Log[] };
type Transaction = { hash?:string;from?:string;to?:string;input?:string;value?:string;nonce?:string;gas?:string;maxFeePerGas?:string;maxPriorityFeePerGas?:string;chainId?:string;blockHash?:string;blockNumber?:string };
type Block = { hash?: string; number?: string; transactions?: Array<string | { hash?: string }> };

export function baseSepoliaRpcUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BASE_SEPOLIA_RPC_URL?.trim() || DEFAULT_BASE_SEPOLIA_RPC;
  let endpoint: URL;
  try { endpoint = new URL(configured); } catch { throw new Error('BASE_SEPOLIA_RPC_URL is invalid'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) throw new Error('Base Sepolia RPC must be an HTTPS URL without embedded credentials or a fragment');
  return endpoint.toString();
}

export function baseSepoliaRpc(env: NodeJS.ProcessEnv = process.env): RpcCall {
  return jsonRpcClient(baseSepoliaRpcUrl(env), { timeoutMs: BASE_RPC_TIMEOUT_MS });
}

export type BaseRpcHealth = { chainId: number; contract: string; contractPresent: boolean; latestBlock: string; latestBlockHash: string };

export async function checkBaseSepoliaRpcHealth(rpc: RpcCall = baseSepoliaRpc()): Promise<BaseRpcHealth> {
  const firstChain = quantity(await rpc<string>('eth_chainId'), 'chain ID');
  if (firstChain !== BigInt(BASE_SEPOLIA_CHAIN_ID)) throw new Error('Base RPC is not Base Sepolia');
  const latest = await rpc<string>('eth_blockNumber');
  const [code, block, secondChainHex] = await Promise.all([
    rpc<string>('eth_getCode', [BASE_USDC, 'latest']),
    rpc<Block | null>('eth_getBlockByNumber', [latest, false]),
    rpc<string>('eth_chainId'),
  ]);
  const secondChain = quantity(secondChainHex, 'chain ID');
  if (secondChain !== firstChain) throw new Error('Base RPC chain identity changed during health check');
  const latestNumber = quantity(latest, 'latest block');
  if (!block || quantity(block.number, 'returned block number') !== latestNumber || !block.hash || !/^0x[0-9a-f]{64}$/i.test(block.hash)) {
    throw new Error('Base RPC returned mismatched latest-chain data');
  }
  if (!/^0x[0-9a-f]+$/i.test(code) || code === '0x') throw new Error('Official Circle test-USDC contract code is unavailable on Base Sepolia');
  return {
    chainId: Number(firstChain), contract: BASE_USDC,
    contractPresent: true,
    latestBlock: latestNumber.toString(), latestBlockHash: block.hash.toLowerCase(),
  };
}

export type BaseVerificationRequest = {
  orderId: string;
  transactionId: string;
  recipient: string;
  amountAtomic: string;
  expectedSender: string;
  minimumConfirmations?: number;
  expectedTransaction?: { nonce:number; calldata:string; gasLimit:string; maxFeePerGas:string; maxPriorityFeePerGas:string };
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
  if (!isFullEvmAddress(request.expectedSender)) throw new Error('Operator-confirmed payout sender is required');

  const rpc = options.rpc ?? baseSepoliaRpc();
  const chainId = quantity(await rpc<string>('eth_chainId'), 'chain ID');
  if (chainId !== BigInt(BASE_SEPOLIA_CHAIN_ID)) throw new Error('RPC is not Base Sepolia');

  const [receipt,transaction] = await Promise.all([rpc<TransactionReceipt | null>('eth_getTransactionReceipt', [request.transactionId]),rpc<Transaction | null>('eth_getTransactionByHash',[request.transactionId])]);
  if (!receipt) throw new Error('Transaction receipt is missing');
  if (!transaction) throw new Error('Transaction body is missing');
  if (receipt.status !== '0x1') throw new Error('Transaction did not succeed');
  if (!receipt.blockHash || !receipt.blockNumber) throw new Error('Transaction is not mined');
  if (receipt.transactionHash?.toLowerCase() !== request.transactionId.toLowerCase()) throw new Error('Receipt transaction ID mismatch');
  if(transaction.hash?.toLowerCase()!==request.transactionId.toLowerCase()||transaction.from?.toLowerCase()!==request.expectedSender.toLowerCase()||transaction.to?.toLowerCase()!==BASE_USDC.toLowerCase()||quantity(transaction.value,'transaction value')!==0n)throw new Error('Transaction body does not match the approved payout sender, token, or zero value');
  if(request.expectedTransaction){const expected=request.expectedTransaction;if(quantity(transaction.chainId,'transaction chain ID')!==84532n||quantity(transaction.nonce,'transaction nonce')!==BigInt(expected.nonce)||transaction.input?.toLowerCase()!==expected.calldata.toLowerCase()||quantity(transaction.gas,'transaction gas')!==BigInt(expected.gasLimit)||quantity(transaction.maxFeePerGas,'transaction max fee')!==BigInt(expected.maxFeePerGas)||quantity(transaction.maxPriorityFeePerGas,'transaction priority fee')!==BigInt(expected.maxPriorityFeePerGas))throw new Error('Transaction body does not match the immutable payout packet');}

  const [latestHex, canonical] = await Promise.all([
    rpc<string>('eth_blockNumber'),
    rpc<Block | null>('eth_getBlockByNumber', [receipt.blockNumber, false]),
  ]);
  if (!canonical || canonical.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new Error('Receipt block is not canonical');
  if(transaction.blockHash?.toLowerCase()!==receipt.blockHash.toLowerCase()||transaction.blockNumber?.toLowerCase()!==receipt.blockNumber.toLowerCase())throw new Error('Transaction and receipt block bindings differ');
  const canonicalTransactions = canonical.transactions ?? [];
  if (!canonicalTransactions.some(tx => (typeof tx === 'string' ? tx : tx.hash)?.toLowerCase() === request.transactionId.toLowerCase())) {
    throw new Error('Transaction is absent from its canonical block');
  }
  const confirmations = quantity(latestHex, 'latest block') - quantity(receipt.blockNumber, 'receipt block') + 1n;
  const minimum = BigInt(request.minimumConfirmations ?? 3);
  if (confirmations < minimum) throw new Error(`Insufficient confirmations: ${confirmations}/${minimum}`);

  const recipient = request.recipient.toLowerCase();
  const sender = request.expectedSender.toLowerCase();
  const amount = BigInt(request.amountAtomic);
  const matching = (receipt.logs ?? []).filter(log =>
    log.removed !== true
    && log.address?.toLowerCase() === BASE_USDC.toLowerCase()
    && log.transactionHash?.toLowerCase() === request.transactionId.toLowerCase()
    && log.blockHash?.toLowerCase() === receipt.blockHash?.toLowerCase()
    && log.topics?.length === 3
    && log.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC
    && topicAddress(log.topics[1]) === sender
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
