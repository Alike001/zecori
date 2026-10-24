import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { jsonRpcClient, type RpcCall } from './rpc-client.ts';
import { loadSourceWalletConfig, type SourceWalletConfig } from './zcash-source-config.ts';

export const SOURCE_PAYMENT_ZATOSHIS = 1_000_000n;
export const SOURCE_FEE_RESERVE_ZATOSHIS = 10_000n;
export const SOURCE_REQUIRED_ZATOSHIS = SOURCE_PAYMENT_ZATOSHIS + SOURCE_FEE_RESERVE_ZATOSHIS;
export const SOURCE_MINIMUM_CONFIRMATIONS = 10;

type ChainInfo = { chain?: string; blocks?: number; headers?: number; initialblockdownload?: boolean };
type WalletInfo = {
  walletname?: string;
  private_keys_enabled?: boolean;
  scanning?: false | object;
  enhanced_through?: number | null;
  import_error?: unknown;
  unlocked_until?: number;
};
type Unspent = {
  amount?: number | string;
  confirmations?: number;
  spendable?: boolean;
  solvable?: boolean;
  safe?: boolean;
  pool?: string;
};

export function exactZecToZatoshis(value: number | string | undefined, label: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} is not an exact nonnegative ZEC amount with at most 8 decimals`);
    // Use the number's canonical round-trippable decimal, including exponent notation, rather
    // than multiplying in binary floating point. This accepts ordinary JSON.parse output while
    // still rejecting sub-zatoshi values and arithmetic noise such as 0.1 + 0.2.
    const match = value.toString().match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    if (match) {
      const digits = `${match[1]}${match[2] ?? ''}`;
      const power = Number(match[3] ?? 0) - (match[2]?.length ?? 0) + 8;
      const exact = power >= 0
        ? BigInt(digits) * (10n ** BigInt(power))
        : digits.endsWith('0'.repeat(-power)) ? BigInt(digits.slice(0, power) || '0') : undefined;
      if (exact !== undefined && exact <= BigInt(Number.MAX_SAFE_INTEGER)) return exact;
    }
    throw new Error(`${label} is not an exact nonnegative ZEC amount with at most 8 decimals`);
  }
  const decimal = value;
  const match = decimal?.match(/^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/);
  if (!match) throw new Error(`${label} is not an exact nonnegative ZEC amount with at most 8 decimals`);
  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? '').padEnd(8, '0'));
}

async function configuredRpc(config: SourceWalletConfig): Promise<RpcCall> {
  const cookie = (await readFile(join(config.dataDir, '.cookie'), 'utf8')).trim();
  if (!cookie || cookie.includes('\n')) throw new Error('Invalid Wallet A RPC cookie');
  return jsonRpcClient(config.rpcUrl, { authorization: `Basic ${Buffer.from(cookie).toString('base64')}`, version: '1.0', timeoutMs: 8_000 });
}

export async function sourceWalletARpc(): Promise<RpcCall> {
  return configuredRpc(await loadSourceWalletConfig());
}

export type SourceWalletHealth = {
  network: 'zcash-testnet';
  synchronized: true;
  historyComplete: true;
  locked: true;
  walletOwned: true;
  walletName: string;
  blocks: number;
  account: 0;
  minimumConfirmations: 10;
  confirmedZatoshis: string;
  aggregateConfirmedZatoshis: string;
  ironwoodUsableZatoshis: string;
  poolZatoshis: Record<string, string>;
  requiredZatoshis: string;
  sufficientForPaymentAndFeeReserve: boolean;
  fullPrivacyCompatible: boolean;
};

export async function checkSourceWalletA(rpc?: RpcCall, expectedWalletName?: string): Promise<SourceWalletHealth> {
  let call = rpc;
  let walletName = expectedWalletName ?? 'default';
  if (!call) {
    const config = await loadSourceWalletConfig();
    walletName = config.walletName;
    call = await configuredRpc(config);
  }
  const [chain, wallet, aggregateValue, unspent] = await Promise.all([
    call<ChainInfo>('getblockchaininfo'),
    call<WalletInfo>('getwalletinfo'),
    call<number | string>('getbalance', ['*', SOURCE_MINIMUM_CONFIRMATIONS]),
    call<Unspent[]>('listunspent', [SOURCE_MINIMUM_CONFIRMATIONS, 9_999_999, [], false]),
  ]);
  if (chain.chain !== 'test' || chain.initialblockdownload !== false || !Number.isSafeInteger(chain.blocks) || chain.blocks !== chain.headers) {
    throw new Error('Wallet A is not synchronized on Zcash testnet');
  }
  if (wallet.walletname !== walletName) throw new Error('Wallet A identity does not match the configured wallet name');
  if (wallet.private_keys_enabled !== true) throw new Error('Wallet A is not an owned spending wallet');
  if (wallet.scanning !== false || wallet.import_error || wallet.enhanced_through !== chain.blocks) throw new Error('Wallet A history is incomplete');
  if (wallet.unlocked_until !== 0) throw new Error('Wallet A must remain encrypted and locked');
  if (!Array.isArray(unspent)) throw new Error('Wallet A listunspent response is invalid');

  const pools = new Map<string, bigint>();
  for (const [index, note] of unspent.entries()) {
    if (!note.pool) {
      throw new Error(`Wallet A Ironwood spendability cannot be proven: listunspent item ${index} has no pool; aggregate getbalance and z_listtransactions history cannot identify current unspent Ironwood notes because internal change is excluded`);
    }
    if (!['transparent', 'sapling', 'orchard', 'ironwood'].includes(note.pool)) throw new Error(`Wallet A unspent item ${index} has an unknown pool`);
    if (!Number.isSafeInteger(note.confirmations) || (note.confirmations as number) < SOURCE_MINIMUM_CONFIRMATIONS) throw new Error(`Wallet A ${note.pool} note violates the minimum confirmation policy`);
    if (note.spendable !== true || note.solvable !== true || note.safe !== true) throw new Error(`Wallet A ${note.pool} note is not safely spendable`);
    pools.set(note.pool, (pools.get(note.pool) ?? 0n) + exactZecToZatoshis(note.amount, `Wallet A ${note.pool} amount`));
  }
  const aggregate = exactZecToZatoshis(aggregateValue, 'Wallet A aggregate balance');
  const ironwood = pools.get('ironwood') ?? 0n;
  if (aggregate < ironwood) throw new Error('Wallet A pool-specific balance exceeds its aggregate confirmed balance');
  const sufficient = aggregate >= SOURCE_REQUIRED_ZATOSHIS && ironwood >= SOURCE_REQUIRED_ZATOSHIS;
  return {
    network: 'zcash-testnet', synchronized: true, historyComplete: true, locked: true, walletOwned: true,
    walletName, blocks: chain.blocks as number, account: 0, minimumConfirmations: SOURCE_MINIMUM_CONFIRMATIONS,
    confirmedZatoshis: ironwood.toString(), aggregateConfirmedZatoshis: aggregate.toString(), ironwoodUsableZatoshis: ironwood.toString(),
    poolZatoshis: Object.fromEntries([...pools.entries()].map(([pool, amount]) => [pool, amount.toString()])),
    requiredZatoshis: SOURCE_REQUIRED_ZATOSHIS.toString(), sufficientForPaymentAndFeeReserve: sufficient,
    fullPrivacyCompatible: ironwood >= SOURCE_REQUIRED_ZATOSHIS,
  };
}
