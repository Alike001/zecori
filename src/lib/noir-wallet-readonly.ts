import {
  detectProvider,
  getNoirWallet,
  type NoirWalletProvider,
  type ZcashAccount,
  type ZcashBalanceResult,
  type ZcashConnectResult,
} from '@noir-wallet/sdk';

export const NOIR_SDK_VERSION = '0.1.9' as const;
export const NOIR_REVIEWED_EXTENSION_VERSION = '1.0.40' as const;
export const NOIR_REQUIRED_ZEC = '0.01' as const;
export const NOIR_READINESS_MAX_AGE_MS = 30_000;

export type NoirConnectionMode = 'silent' | 'interactive';
export type NoirReadinessCode =
  | 'NOT_DETECTED'
  | 'NO_ACCOUNT'
  | 'AUTHORIZATION_REJECTED'
  | 'WRONG_BUILD'
  | 'UNSUPPORTED_CONFIGURATION'
  | 'INSUFFICIENT_FUNDS'
  | 'UNAVAILABLE'
  | 'STALE';

export type NoirBalanceReadiness = {
  shielded: string;
  available: string;
  pending: string;
  unit: 'ZEC';
  synced: boolean;
  status: 'sufficient-provisional' | 'insufficient' | 'unavailable';
};

export type NoirWalletReadiness = {
  ready: false;
  code: NoirReadinessCode;
  message: string;
  checkedAt: number;
  walletDetected: boolean;
  authorized: boolean;
  extensionVersion?: string;
  account?: { id: string; label: string; authorizedCount: number };
  balance?: NoirBalanceReadiness;
  compatibility: {
    sdkVersion: typeof NOIR_SDK_VERSION;
    extensionBuild: 'compatible-version' | 'wrong-version' | 'unverifiable';
    network: 'unverified';
    pool: 'unverified';
  };
};

export type NoirMaxTransferProbe = Readonly<{
  requestedAmount: typeof NOIR_REQUIRED_ZEC;
  fundingSource: 'shielded';
  memo: '';
  feeTier: 'standard';
  maxAmount: string;
  fee: string;
  canCoverExactPayment: boolean;
  accountStable: true;
  spendingEnabled: false;
  networkAttested: false;
  ironwoodAttested: false;
}>;

type NoirDetector = {
  getWallet(): NoirWalletProvider | null;
  detect(timeout: number): Promise<unknown>;
};

const defaultDetector: NoirDetector = { getWallet: getNoirWallet, detect: detectProvider };

function baseReadiness(now: number): Pick<NoirWalletReadiness, 'ready' | 'checkedAt' | 'compatibility'> {
  return {
    ready: false,
    checkedAt: now,
    compatibility: { sdkVersion: NOIR_SDK_VERSION, extensionBuild: 'unverifiable', network: 'unverified', pool: 'unverified' },
  };
}

function providerErrorCode(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'number' ? error.code : undefined;
}

function validAccount(value: unknown): value is ZcashAccount {
  if (!value || typeof value !== 'object') return false;
  const account = value as Partial<ZcashAccount>;
  return typeof account.id === 'string' && account.id.length > 0
    && typeof account.label === 'string'
    && typeof account.walletId === 'string'
    && typeof account.accountId === 'string'
    && !!account.addresses
    && typeof account.addresses.transparent === 'string'
    && typeof account.addresses.shielded === 'string';
}

function validConnection(value: unknown): value is ZcashConnectResult {
  if (!value || typeof value !== 'object') return false;
  const connection = value as Partial<ZcashConnectResult>;
  return typeof connection.transparent === 'string'
    && typeof connection.shielded === 'string'
    && Array.isArray(connection.accounts)
    && connection.accounts.length > 0
    && connection.accounts.every(validAccount);
}

function decimalToAtomic(value: string, decimals = 8): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals));
}

function atomicToDecimal(value: bigint, decimals = 8): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function primaryAccountId(connection: ZcashConnectResult | null): string | undefined {
  return connection && validConnection(connection) ? connection.accounts[0]?.id : undefined;
}

function classifyBalance(raw: ZcashBalanceResult, accountId: string): NoirBalanceReadiness {
  const accountBalance = raw.accounts.find(item => item.id === accountId);
  const balance = accountBalance?.balance ?? raw;
  const synced = accountBalance?.synced ?? false;
  const shielded = decimalToAtomic(balance.shielded);
  const availableText = balance.available ?? balance.spendable;
  const available = availableText ? decimalToAtomic(availableText) : null;
  const total = balance.total ? decimalToAtomic(balance.total) : null;
  const required = decimalToAtomic(NOIR_REQUIRED_ZEC)!;
  const pending = total !== null && available !== null && total > available ? total - available : 0n;
  const status = !synced || shielded === null || available === null
    ? 'unavailable' as const
    : shielded < required || available < required
      ? 'insufficient' as const
      : 'sufficient-provisional' as const;
  return {
    shielded: shielded === null ? 'unavailable' : atomicToDecimal(shielded),
    available: available === null ? 'unavailable' : atomicToDecimal(available),
    pending: atomicToDecimal(pending),
    unit: 'ZEC', synced, status,
  };
}

function extensionCompatibility(version: string | undefined): NoirWalletReadiness['compatibility']['extensionBuild'] {
  if (!version) return 'unverifiable';
  return version === NOIR_REVIEWED_EXTENSION_VERSION ? 'compatible-version' : 'wrong-version';
}

export async function detectOfficialNoirWallet(timeout = 750, detector: NoirDetector = defaultDetector): Promise<NoirWalletProvider | null> {
  const immediate = detector.getWallet();
  if (immediate?.isNoirWallet) return immediate;
  try { await detector.detect(timeout); } catch { return null; }
  const detected = detector.getWallet();
  return detected?.isNoirWallet ? detected : null;
}

/**
 * Reads only origin-authorized account data. Interactive mode must be called
 * directly from a deliberate Connect click. No result is persisted or sent to
 * Zecori's server.
 *
 * SDK 0.1.9 exposes an extension version but no build-network or pool claim.
 * Therefore even the reviewed 1.0.40 version remains fail-closed for spending:
 * mainnet and testnet artifacts share that version and an address is not an
 * acceptable network or Ironwood attestation.
 */
export async function inspectNoirWallet(wallet: NoirWalletProvider | null, mode: NoirConnectionMode, now = Date.now()): Promise<NoirWalletReadiness> {
  const base = baseReadiness(now);
  if (!wallet?.isNoirWallet || !wallet.zcash) {
    return { ...base, code: 'NOT_DETECTED', message: 'Official Noir Wallet was not detected.', walletDetected: false, authorized: false };
  }
  const extensionBuild = extensionCompatibility(wallet.version);
  const compatibility = { ...base.compatibility, extensionBuild };
  let connection: ZcashConnectResult | null;
  try { connection = mode === 'interactive' ? await wallet.zcash.connect() : await wallet.zcash.getAccounts(); }
  catch (error) {
    const rejected = mode === 'interactive' && (providerErrorCode(error) === 4001 || /reject|denied|cancel/i.test(error instanceof Error ? error.message : ''));
    return {
      ...base, compatibility,
      code: rejected ? 'AUTHORIZATION_REJECTED' : 'UNAVAILABLE',
      message: rejected ? 'Noir Wallet authorization was rejected. Nothing was connected or sent.' : 'Noir Wallet could not return authorized accounts.',
      walletDetected: true, authorized: false, ...(wallet.version ? { extensionVersion: wallet.version } : {}),
    };
  }
  if (connection === null) {
    return { ...base, compatibility, code: 'NO_ACCOUNT', message: 'Noir Wallet is installed, but this site has no previous authorization.', walletDetected: true, authorized: false, ...(wallet.version ? { extensionVersion: wallet.version } : {}) };
  }
  if (!validConnection(connection)) {
    return { ...base, compatibility, code: 'UNAVAILABLE', message: 'Noir Wallet returned an invalid authorized-account response.', walletDetected: true, authorized: false, ...(wallet.version ? { extensionVersion: wallet.version } : {}) };
  }
  const selected = connection.accounts[0];
  let rawBalance: ZcashBalanceResult;
  try { rawBalance = await wallet.zcash.getBalance(selected.id); }
  catch {
    return {
      ...base, compatibility, code: 'UNAVAILABLE', message: 'The authorized account is available, but its balance could not be read.', walletDetected: true, authorized: true,
      ...(wallet.version ? { extensionVersion: wallet.version } : {}), account: { id: selected.id, label: selected.label, authorizedCount: connection.accounts.length },
    };
  }
  const balance = classifyBalance(rawBalance, selected.id);
  const common = {
    ...base, compatibility, walletDetected: true, authorized: true,
    ...(wallet.version ? { extensionVersion: wallet.version } : {}),
    account: { id: selected.id, label: selected.label, authorizedCount: connection.accounts.length }, balance,
  };
  if (extensionBuild !== 'compatible-version') {
    return { ...common, code: 'WRONG_BUILD', message: wallet.version ? `Noir Wallet ${wallet.version} is not the reviewed 1.0.40 build.` : 'This Noir Wallet build does not expose a verifiable version.' };
  }
  if (balance.status === 'insufficient') {
    return { ...common, code: 'INSUFFICIENT_FUNDS', message: `The account does not show both ${NOIR_REQUIRED_ZEC} shielded ZEC and ${NOIR_REQUIRED_ZEC} available ZEC.` };
  }
  if (balance.status === 'unavailable') {
    return { ...common, code: 'UNAVAILABLE', message: 'The account balance is not synchronized or does not expose a trustworthy available amount.' };
  }
  return {
    ...common, code: 'UNSUPPORTED_CONFIGURATION',
    message: 'Noir Wallet 1.0.40 is API-compatible, but SDK 0.1.9 cannot attest that the installed build is the official testnet artifact or that these funds are Ironwood. Sending remains disabled.',
  };
}

export function expireNoirReadiness(readiness: NoirWalletReadiness, now = Date.now(), maxAgeMs = NOIR_READINESS_MAX_AGE_MS): NoirWalletReadiness {
  if (now - readiness.checkedAt <= maxAgeMs || readiness.code === 'STALE') return readiness;
  return { ...readiness, ready: false, code: 'STALE', message: 'Noir Wallet readiness is stale. Recheck the current authorized account before continuing.' };
}

export function subscribeToNoirAccountChanges(wallet: NoirWalletProvider, listener: () => void): () => void {
  wallet.zcash.on('accountsChanged', listener);
  wallet.zcash.on('chainChanged', listener);
  return () => {
    wallet.zcash.removeListener('accountsChanged', listener);
    wallet.zcash.removeListener('chainChanged', listener);
  };
}

/**
 * Performs the recipient-aware Max calculation without preparing, signing, or
 * broadcasting a transaction. Call only from an explicit operator-driven
 * acceptance action after the exact allocated receiver is available.
 *
 * A successful result is deliberately not a payment-ready signal: SDK 0.1.9
 * still cannot attest the installed network build or the source note pool.
 */
export async function probeNoirShieldedMaxTransfer(wallet: NoirWalletProvider | null, receiver: string): Promise<NoirMaxTransferProbe> {
  if (!wallet?.isNoirWallet || !wallet.zcash) throw new Error('Official Noir Wallet was not detected.');
  if (wallet.version !== NOIR_REVIEWED_EXTENSION_VERSION) throw new Error(`Expected the reviewed Noir Wallet ${NOIR_REVIEWED_EXTENSION_VERSION} build.`);
  if (!receiver.startsWith('utest1') || receiver !== receiver.trim() || /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(receiver)) {
    throw new Error('An exact clean Zcash testnet receiver is required for Max calculation.');
  }
  const before = await wallet.zcash.getAccounts();
  const beforeId = primaryAccountId(before);
  if (!beforeId) throw new Error('No authorized Noir account is available.');
  const estimate = await wallet.zcash.getMaxTransfer({ to: receiver, memo: '', feeTier: 'standard', fundingSource: 'shielded' });
  const after = await wallet.zcash.getAccounts();
  if (primaryAccountId(after) !== beforeId) throw new Error('The Noir account changed during Max calculation; the result was discarded.');
  const max = decimalToAtomic(estimate.maxAmount);
  const fee = decimalToAtomic(estimate.fee);
  if (max === null || fee === null) throw new Error('Noir Wallet returned an inexact Max or fee amount.');
  return Object.freeze({
    requestedAmount: NOIR_REQUIRED_ZEC, fundingSource: 'shielded', memo: '', feeTier: 'standard',
    maxAmount: atomicToDecimal(max), fee: atomicToDecimal(fee), canCoverExactPayment: max >= decimalToAtomic(NOIR_REQUIRED_ZEC)!,
    accountStable: true, spendingEnabled: false, networkAttested: false, ironwoodAttested: false,
  });
}

export const inspectNoirWalletReadOnly = (wallet: NoirWalletProvider | undefined) => inspectNoirWallet(wallet ?? null, 'silent');
