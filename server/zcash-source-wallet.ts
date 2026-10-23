import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonRpcClient, type RpcCall } from './rpc-client.ts';
import { loadSourceWalletConfig } from './zcash-source-config.ts';

export const SOURCE_PAYMENT_ZATOSHIS = 1_000_000n;
export const SOURCE_FEE_RESERVE_ZATOSHIS = 10_000n;
export const SOURCE_REQUIRED_ZATOSHIS = SOURCE_PAYMENT_ZATOSHIS + SOURCE_FEE_RESERVE_ZATOSHIS;
export const SOURCE_MINIMUM_CONFIRMATIONS = 10;

type ChainInfo = { chain?: string; blocks?: number; headers?: number; initialblockdownload?: boolean; initial_block_download_complete?: boolean };
type WalletInfo = { scanning?: false | object; enhanced_through?: number | null; import_error?: unknown; unlocked_until?: number };
type PoolBalance = { valueZat?: number | string };
type AccountBalance = { pools?: Record<string, PoolBalance>; minimum_confirmations?: number };

function exactNonnegative(value: number | string | undefined, label: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is not an exact nonnegative integer`);
    return BigInt(value);
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`${label} is not an exact nonnegative integer`);
  return BigInt(value);
}

export async function sourceWalletARpc(): Promise<RpcCall> {
  const config = await loadSourceWalletConfig();
  const cookie = (await readFile(join(config.dataDir, '.cookie'), 'utf8')).trim();
  if (!cookie || cookie.includes('\n')) throw new Error('Invalid Wallet A RPC cookie');
  return jsonRpcClient(config.rpcUrl, { authorization: `Basic ${Buffer.from(cookie).toString('base64')}`, version: '1.0', timeoutMs: 8_000 });
}

export type SourceWalletHealth = {
  network: 'zcash-testnet';
  synchronized: boolean;
  historyComplete: boolean;
  locked: boolean;
  blocks: number;
  account: 0;
  minimumConfirmations: 10;
  confirmedZatoshis: string;
  requiredZatoshis: string;
  sufficientForPaymentAndFeeReserve: boolean;
};

export async function checkSourceWalletA(rpc?: RpcCall): Promise<SourceWalletHealth> {
  const call = rpc ?? await sourceWalletARpc();
  const [chain, wallet, balance] = await Promise.all([
    call<ChainInfo>('getblockchaininfo'),
    call<WalletInfo>('getwalletinfo'),
    call<AccountBalance>('z_getbalanceforaccount', [0, SOURCE_MINIMUM_CONFIRMATIONS]),
  ]);
  const synchronized = chain.chain === 'test' && Number.isSafeInteger(chain.blocks) && chain.blocks === chain.headers
    && (chain.initialblockdownload === false || chain.initial_block_download_complete === true);
  if (!synchronized) throw new Error('Wallet A is not synchronized on Zcash testnet');
  const historyComplete = wallet.scanning === false && !wallet.import_error && wallet.enhanced_through === chain.blocks;
  if (!historyComplete) throw new Error('Wallet A history is incomplete');
  const locked = typeof wallet.unlocked_until === 'number' && wallet.unlocked_until <= Math.floor(Date.now() / 1000);
  if (!locked) throw new Error('Wallet A must remain encrypted and locked');
  if (balance.minimum_confirmations !== SOURCE_MINIMUM_CONFIRMATIONS) throw new Error('Wallet A balance confirmation policy mismatch');
  const confirmed = Object.entries(balance.pools ?? {}).reduce((total, [pool, value]) => total + exactNonnegative(value.valueZat, `Wallet A ${pool} balance`), 0n);
  return {
    network: 'zcash-testnet', synchronized, historyComplete, locked, blocks: chain.blocks as number,
    account: 0, minimumConfirmations: SOURCE_MINIMUM_CONFIRMATIONS,
    confirmedZatoshis: confirmed.toString(), requiredZatoshis: SOURCE_REQUIRED_ZATOSHIS.toString(),
    sufficientForPaymentAndFeeReserve: confirmed >= SOURCE_REQUIRED_ZATOSHIS,
  };
}
