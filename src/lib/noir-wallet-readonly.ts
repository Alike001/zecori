import type { WalletReadiness } from './wallet-readiness.ts';

export type NoirRawProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export type NoirInjectedWallet = {
  isNoirWallet?: boolean;
  zcash?: NoirRawProvider;
};

type NoirAccountResult = {
  transparent: string;
  shielded: string;
  accounts: unknown[];
};

function isAccountResult(value: unknown): value is NoirAccountResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<NoirAccountResult>;
  return typeof result.transparent === 'string'
    && typeof result.shielded === 'string'
    && Array.isArray(result.accounts);
}

/**
 * Compatibility probe for Noir Wallet v1. It intentionally uses only the
 * silent zcash_getAccounts method. A valid account response is still not
 * enough for Zecori: v1 does not attest the installed network build or the
 * Ironwood source pool in that response, so the application must fail closed.
 */
export async function inspectNoirWalletReadOnly(wallet: NoirInjectedWallet | undefined): Promise<WalletReadiness> {
  if (!wallet?.isNoirWallet || !wallet.zcash || typeof wallet.zcash.request !== 'function') {
    return { ready: false, code: 'NOT_DETECTED', message: 'Noir Wallet was not detected.' };
  }
  try {
    const connection = await wallet.zcash.request({ method: 'zcash_getAccounts' });
    if (connection === null) {
      return { ready: false, code: 'NO_ACCOUNT', message: 'Noir Wallet is detected with no existing site authorization. Zecori did not open a connection request.' };
    }
    if (!isAccountResult(connection)) {
      return { ready: false, code: 'UNSUPPORTED_ADAPTER', message: 'Noir Wallet returned an unsupported silent account response.' };
    }
    return {
      ready: false,
      code: 'UNSUPPORTED_ADAPTER',
      message: 'Noir Wallet access exists, but v1 does not attest the testnet build and Ironwood pool in its silent response. Compatibility remains disabled.',
    };
  } catch {
    return { ready: false, code: 'UNAVAILABLE', message: 'Noir Wallet did not complete the read-only compatibility probe.' };
  }
}
