import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { BASE_USDC, FIXED_RATE, isFullEvmAddress, TRUSTED_PROVIDER_ID } from '../src/lib/order-coordinator.ts';
import { baseSepoliaRpc, checkBaseSepoliaRpcHealth, type BaseRpcHealth } from './base-sepolia-verifier.ts';
import { FileOrderStore } from './order-api.ts';
import { inspectOperatorKey, OperatorControlStore } from './operator-control.ts';
import type { RpcCall } from './rpc-client.ts';
import { walletBRpc, ZECD_WALLET_B_NAME } from './zcash-verifier.ts';

const BALANCE_OF_SELECTOR = '70a08231';
export const MINIMUM_GAS_WEI = 100_000_000_000_000n;
export const REQUIRED_PAYOUT_ATOMIC = 1_000_000n;

function quantity(value: string, label: string): bigint {
  if (!/^0x[0-9a-f]+$/i.test(value)) throw new Error(`${label} is not a valid hexadecimal quantity`);
  return BigInt(value);
}

function balanceOfData(address: string): string {
  if (!isFullEvmAddress(address)) throw new Error('LP address must be a complete Base address');
  return `0x${BALANCE_OF_SELECTOR}${address.slice(2).toLowerCase().padStart(64, '0')}`;
}

export type ZcashHealth = {
  network: 'zcash-testnet'; synchronized: boolean; locked: boolean; historyComplete: boolean; walletOwned: true; walletName: string; blocks: number;
};

export async function checkZcashHealth(rpc?: RpcCall): Promise<ZcashHealth> {
  const call = rpc ?? await walletBRpc();
  const [chain, wallet] = await Promise.all([
    call<{ chain?: string; blocks?: number; headers?: number; initialblockdownload?: boolean }>('getblockchaininfo'),
    call<{ walletname?: string; private_keys_enabled?: boolean; scanning?: false | object; enhanced_through?: number | null; import_error?: unknown; unlocked_until?: number }>('getwalletinfo'),
  ]);
  if (chain.chain !== 'test' || !Number.isSafeInteger(chain.blocks)) throw new Error('Wallet B is not on Zcash testnet');
  if (wallet.walletname !== ZECD_WALLET_B_NAME || wallet.private_keys_enabled !== true) throw new Error('Wallet B identity or ownership mismatch');
  return {
    network: 'zcash-testnet', blocks: chain.blocks as number, walletOwned: true, walletName: ZECD_WALLET_B_NAME,
    synchronized: chain.initialblockdownload === false && chain.blocks === chain.headers,
    historyComplete: wallet.scanning === false && !wallet.import_error && wallet.enhanced_through === chain.blocks,
    locked: wallet.unlocked_until === 0,
  };
}

export type BaseHealth = BaseRpcHealth;

export async function checkBaseHealth(rpc?: RpcCall): Promise<BaseHealth> {
  return checkBaseSepoliaRpcHealth(rpc);
}

export type LiquidityHealth = { usdcAtomic: string; ethWei: string; sufficientUsdc: boolean; sufficientGas: boolean };

export async function checkLiquidity(lpAddress: string, rpc: RpcCall = baseSepoliaRpc()): Promise<LiquidityHealth> {
  if (!isFullEvmAddress(lpAddress)) throw new Error('Operator-confirmed LP address is missing or invalid');
  const [token, gas] = await Promise.all([
    rpc<string>('eth_call', [{ to: BASE_USDC, data: balanceOfData(lpAddress) }, 'latest']),
    rpc<string>('eth_getBalance', [lpAddress, 'latest']),
  ]);
  const usdc = quantity(token, 'test-USDC balance'); const eth = quantity(gas, 'test ETH balance');
  return { usdcAtomic: usdc.toString(), ethWei: eth.toString(), sufficientUsdc: usdc >= REQUIRED_PAYOUT_ATOMIC, sufficientGas: eth >= MINIMUM_GAS_WEI };
}

export function previewTerms(recipient: string, now = Date.now(), expiryMinutes = 30) {
  if (!isFullEvmAddress(recipient)) throw new Error('An operator-confirmed full Base recipient is required');
  if (!Number.isSafeInteger(expiryMinutes) || expiryMinutes < 10 || expiryMinutes > 1440) throw new Error('Expiry must be between 10 and 1440 minutes');
  return {
    source: { amount: '0.01', amountZatoshis: '1000000', asset: 'TAZ', network: 'zcash-testnet', pool: 'ironwood', minimumConfirmations: 10 },
    destination: { amount: '1', amountAtomic: '1000000', asset: 'Circle test USDC', network: 'base-sepolia', chainId: 84532, contract: BASE_USDC, recipient, minimumConfirmations: 3 },
    fixedRate: FIXED_RATE.description,
    provider: { id: TRUSTED_PROVIDER_ID, custodyDisclosure: 'The testnet LP temporarily controls received TAZ; payout and any refund require separate manual operator actions and independent verification.' },
    expiresAt: new Date(now + expiryMinutes * 60_000).toISOString(),
    policies: {
      latePayment: 'Late source funds enter manual REFUND_PENDING review; no automatic or guaranteed refund.',
      unsuccessfulPayout: 'A failed payout is never completed and requires operator reconciliation.',
      uncertainBroadcast: 'An uncertain payout broadcast enters UNRESOLVED and is not automatically retried.',
      refunds: 'Refunds are manual, testnet-only, and must be independently verified before REFUNDED.',
    },
  };
}

async function databaseHealth(store: FileOrderStore): Promise<{ ready: boolean; mode?: string; reason?: string }> {
  const path = store.databasePath();
  try {
    const [file, folder] = await Promise.all([stat(path), stat(dirname(path))]);
    await access(path, constants.R_OK | constants.W_OK);
    const fileMode = file.mode & 0o777; const folderMode = folder.mode & 0o777;
    return file.isFile() && fileMode === 0o600 && folder.isDirectory() && folderMode === 0o700
      ? { ready: true, mode: '0600 file / 0700 directory' }
      : { ready: false, mode: `${fileMode.toString(8)} file / ${folderMode.toString(8)} directory`, reason: 'database permissions are not private' };
  } catch (error) {
    return { ready: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'order database is not initialized' : 'order database is not readable and writable' };
  }
}

export async function runOperatorPreflight(input: {
  lpAddress?: string; recipient?: string; confirmedRecipient?: string;
  zcashRpc?: RpcCall; baseRpc?: RpcCall; orders?: FileOrderStore; controls?: OperatorControlStore;
  operatorKeyStatus?: { ready: boolean; reason?: string };
  requireFreshAllocation?: boolean;
}) {
  const requireFreshAllocation = input.requireFreshAllocation ?? true;
  const blockers: string[] = [];
  let zcash: ZcashHealth | undefined; let base: BaseHealth | undefined; let liquidity: LiquidityHealth | undefined;
  try { zcash = await checkZcashHealth(input.zcashRpc); if (!zcash.synchronized || !zcash.historyComplete || !zcash.locked) blockers.push('Wallet B must be synchronized, history-complete and locked'); } catch (error) { blockers.push(error instanceof Error ? error.message : 'Zcash health check failed'); }
  try { base = await checkBaseHealth(input.baseRpc); if (!base.contractPresent) blockers.push('Circle test-USDC contract code is unavailable'); } catch (error) { blockers.push(error instanceof Error ? error.message : 'Base health check failed'); }
  if (!input.lpAddress) blockers.push('operator-confirmed LP Base address is required');
  else try { liquidity = await checkLiquidity(input.lpAddress, input.baseRpc); if (!liquidity.sufficientUsdc) blockers.push('insufficient Circle test-USDC payout liquidity'); if (!liquidity.sufficientGas) blockers.push('insufficient Base Sepolia test ETH for gas'); } catch (error) { blockers.push(error instanceof Error ? error.message : 'liquidity check failed'); }
  if (!input.recipient || input.recipient.toLowerCase() !== input.confirmedRecipient?.toLowerCase() || !isFullEvmAddress(input.recipient)) blockers.push('Base recipient has not been explicitly operator-confirmed');

  const orders = input.orders ?? new FileOrderStore(); const controls = input.controls ?? new OperatorControlStore();
  let orderSummary: Awaited<ReturnType<FileOrderStore['operatorSnapshot']>> | undefined;
  try {
    orderSummary = await orders.operatorSnapshot();
    const conflicting = orderSummary.orders.filter(order => !['COMPLETED', 'FAILED', 'REFUNDED'].includes(order.status));
    const safelyAllocated = conflicting.length === 1 && conflicting[0].status === 'CREATED';
    if (conflicting.length && !safelyAllocated) blockers.push(`${conflicting.length} pending or unresolved order(s) require reconciliation`);
  } catch (error) { blockers.push(error instanceof Error ? error.message : 'order database inspection failed'); }
  const database = await databaseHealth(orders); if (!database.ready) blockers.push(database.reason!);
  const key = input.operatorKeyStatus ?? await inspectOperatorKey(); if (!key.ready) blockers.push(key.reason!);
  const controlDatabase = await controls.health(); if (!controlDatabase.ready) blockers.push(controlDatabase.reason!);
  let control: Awaited<ReturnType<OperatorControlStore['inspect']>> = { authorizations: [], allocations: [] };
  try { control = await controls.inspect(); } catch (error) { blockers.push(error instanceof Error ? error.message : 'operator control database inspection failed'); }
  const recoveryRequired = control.allocations.filter(item => item.state !== 'RESERVED');
  if (recoveryRequired.length) blockers.push(`${recoveryRequired.length} address allocation operation(s) require crash recovery`);
  const boundCreatedOrders = orderSummary?.orders.filter(order => order.status === 'CREATED') ?? [];
  if (boundCreatedOrders.some(order => !control.allocations.some(item => item.orderId === order.id && item.state === 'RESERVED'))) blockers.push('bound operator order is missing its completed allocation journal');
  if (control.authorizations.some(item => item.state === 'IN_PROGRESS' && item.action === 'PAYOUT_APPROVAL')) blockers.push('an unresolved payout authorization is in progress');

  const operatorConfigured = blockers.length === 0;
  const hasBoundCreatedOrder = boundCreatedOrders.length === 1 && (orderSummary?.allocationCounts.assigned ?? 0) === 1;
  if (requireFreshAllocation && (orderSummary?.allocationCounts.available ?? 0) < 1 && !hasBoundCreatedOrder) blockers.push('fresh Orchard receiving address has not yet been explicitly authorized and durably bound to the operator order');

  const readyForFirstPayment = blockers.length === 0 && ((orderSummary?.allocationCounts.available ?? 0) >= 1 || hasBoundCreatedOrder);

  return {
    stage: (operatorConfigured && !requireFreshAllocation ? 'OPERATOR_CONFIGURED' : 'OPERATOR_PREFLIGHT_READY') as 'OPERATOR_CONFIGURED' | 'OPERATOR_PREFLIGHT_READY',
    operatorConfigured,
    readyForFirstPayment,
    blockers: [...new Set(blockers)], zcash, base, liquidity, database, controlDatabase, operatorKey: key,
    pendingOrders: orderSummary?.orders ?? [], allocationCounts: orderSummary?.allocationCounts ?? { available: 0, assigned: 0 },
    replayReferenceCount: orderSummary?.replayReferenceCount ?? 0,
    allocationRecovery: recoveryRequired.map(item => ({ allocationId: item.allocationId, state: item.state })),
    historicalEvidenceEligible: false,
  };
}
