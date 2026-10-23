import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isFullTransactionId } from '../src/lib/order-coordinator.ts';
import type { ZcashShieldedReceipt } from '../src/lib/read-only-verification.ts';
import { jsonRpcClient, type RpcCall } from './rpc-client.ts';

export const ZECD_WALLET_B_RPC = 'http://127.0.0.1:18393/';
export const ZECD_WALLET_B_DATA = join(homedir(), '.local', 'share', 'zecd-wallet-b-testnet');

type ChainInfo = { chain?: string; blocks?: number; headers?: number; initialblockdownload?: boolean };
type WalletInfo = { scanning?: false | { progress?: number; pending_enhancements?: number }; enhanced_through?: number | null; import_error?: unknown; txcount?: number; unlocked_until?: number };
type AddressInfo = { address?: string; ismine?: boolean; isvalid_orchard?: boolean; receiver_types?: string[]; receivers_consistent?: boolean; diversifier_index?: number | string };
type WalletTransaction = { txid?: string; confirmations?: number; blockhash?: string; blockheight?: number; blocktime?: number; details?: HistoryEntry[] };
type HistoryEntry = { txid?: string; status?: string; confirmations?: number; pool?: string; category?: string; amountZat?: number | string; address?: string; outgoing?: boolean; change?: boolean; blockhash?: string; blockheight?: number; diversifier_index?: number | string; outindex?: number };

export type ZcashVerificationRequest = {
  orderId: string;
  transactionId: string;
  receiver: string;
  amountZatoshis: string;
  expectedDiversifierIndex?: string;
  minimumBlockHeight?: number;
  minimumBlockTime?: number;
  requiredPool?: 'ironwood';
  minimumConfirmations?: number;
};

function exactInteger(value: number | string | undefined): string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : undefined;
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value).toString() : undefined;
}

export async function walletBCookieAuthorization(): Promise<string> {
  const cookie = (await readFile(join(ZECD_WALLET_B_DATA, '.cookie'), 'utf8')).trim();
  if (!cookie || cookie.includes('\n')) throw new Error('Invalid zecd RPC cookie');
  return `Basic ${Buffer.from(cookie).toString('base64')}`;
}

export async function walletBRpc(): Promise<RpcCall> {
  return jsonRpcClient(ZECD_WALLET_B_RPC, { authorization: await walletBCookieAuthorization(), version: '1.0', timeoutMs: 8_000 });
}

export async function verifyZcashTransaction(
  request: ZcashVerificationRequest,
  options: { rpc?: RpcCall } = {},
): Promise<ZcashShieldedReceipt> {
  if (!isFullTransactionId(request.transactionId) || request.transactionId.startsWith('0x')) throw new Error('Zcash transaction ID must be complete');
  if (!request.receiver.startsWith('utest1')) throw new Error('Receiver is not a Zcash testnet Unified Address');
  if (!/^\d+$/.test(request.amountZatoshis) || BigInt(request.amountZatoshis) <= 0n) throw new Error('Zcash amount must be positive zatoshis');
  if (request.expectedDiversifierIndex && !/^\d+$/.test(request.expectedDiversifierIndex)) throw new Error('Expected diversifier index must be an unsigned integer');
  const rpc = options.rpc ?? await walletBRpc();

  const [chain, wallet, address, transaction] = await Promise.all([
    rpc<ChainInfo>('getblockchaininfo'),
    rpc<WalletInfo>('getwalletinfo'),
    rpc<AddressInfo>('getaddressinfo', [request.receiver]),
    rpc<WalletTransaction>('gettransaction', [request.transactionId]),
  ]);
  if (chain.chain !== 'test') throw new Error('zecd is not on Zcash testnet');
  if (chain.initialblockdownload !== false || !Number.isInteger(chain.blocks) || chain.blocks !== chain.headers) throw new Error('zecd chain is not fully synchronized');
  if (wallet.scanning !== false || wallet.import_error) throw new Error('zecd wallet scan or history enhancement is incomplete');
  if (typeof wallet.enhanced_through !== 'number' || wallet.enhanced_through < (chain.blocks ?? 0)) throw new Error('zecd wallet history is not complete through the chain tip');
  if (typeof wallet.unlocked_until !== 'number' || wallet.unlocked_until > Math.floor(Date.now() / 1_000)) throw new Error('zecd wallet must be encrypted and remain locked during verification');
  if (address.ismine !== true || address.isvalid_orchard !== true || !address.receiver_types?.includes('orchard') || address.receivers_consistent === false) {
    throw new Error('Receiver is not an owned consistent Orchard-capable address');
  }
  const addressIndex = exactInteger(address.diversifier_index);
  if (address.address !== request.receiver || addressIndex === undefined) throw new Error('Receiver address or diversifier identity is incomplete');
  if (request.expectedDiversifierIndex && addressIndex !== BigInt(request.expectedDiversifierIndex).toString()) throw new Error('Receiver diversifier index does not match the order');
  if (transaction.txid?.toLowerCase() !== request.transactionId.toLowerCase()) throw new Error('Wallet transaction ID mismatch');
  const minimum = request.minimumConfirmations ?? 10;
  if (!transaction.blockhash || !transaction.blockheight || (transaction.confirmations ?? 0) < minimum) throw new Error('Zcash transaction is not sufficiently confirmed and mined');
  if (request.minimumBlockHeight !== undefined && transaction.blockheight < request.minimumBlockHeight) throw new Error('Historical Zcash payment predates this order allocation');
  if (!Number.isSafeInteger(transaction.blocktime) || (transaction.blocktime ?? 0) <= 0) throw new Error('Zcash transaction mined time is unavailable');
  if (request.minimumBlockTime !== undefined && (transaction.blocktime as number) < request.minimumBlockTime) throw new Error('Historical Zcash payment predates this order');

  const canonicalHash = await rpc<string>('getblockhash', [transaction.blockheight]);
  if (canonicalHash !== transaction.blockhash) throw new Error('Zcash transaction block is not canonical');
  const history: HistoryEntry[] = [];
  for (let offset = 0; offset < 10_000; offset += 100) {
    const page = await rpc<HistoryEntry[]>('z_listtransactions', [100, offset, false]);
    history.push(...page);
    if (page.length < 100) break;
  }
  const outputs = history.filter(entry => entry.txid?.toLowerCase() === request.transactionId.toLowerCase());
  const matching = outputs.filter(entry =>
    entry.status === 'mined'
    && entry.category === 'receive'
    && entry.outgoing === false
    && entry.change === false
    && entry.pool === (request.requiredPool ?? 'ironwood')
    && entry.address === request.receiver
    && exactInteger(entry.amountZat) === BigInt(request.amountZatoshis).toString()
    && entry.blockhash === transaction.blockhash
    && entry.blockheight === transaction.blockheight
    && (entry.confirmations ?? 0) >= minimum
    && exactInteger(entry.diversifier_index) === addressIndex
    && Number.isSafeInteger(entry.outindex)
    && (entry.outindex ?? -1) >= 0
  );
  if (matching.length !== 1) throw new Error('Exactly one matching incoming Ironwood output is required');
  const output = matching[0];

  const zec = `${BigInt(request.amountZatoshis) / 100_000_000n}.${(BigInt(request.amountZatoshis) % 100_000_000n).toString().padStart(8, '0')}`.replace(/\.?0+$/, '');
  return {
    orderId: request.orderId,
    transactionId: request.transactionId.toLowerCase(),
    network: 'zcash-testnet',
    receiver: request.receiver,
    amount: zec,
    amountZatoshis: BigInt(request.amountZatoshis).toString(),
    pool: 'ironwood',
    status: 'mined',
    confirmations: output.confirmations as number,
    blockHeight: output.blockheight as number,
    blockHash: output.blockhash as string,
    blockTime: transaction.blocktime as number,
    outputIndex: output.outindex as number,
    diversifierIndex: addressIndex,
    shielded: true,
    independentlyVerified: true,
  };
}
