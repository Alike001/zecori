import { WalletStore } from '@rhea-finance/zcash-wallet-adapter/core';
import { NoirZcashWalletAdapter } from '@rhea-finance/zcash-wallet-adapter/noir-wallet';

/** Intentionally read-only: this module never invokes zcash_sendTransaction. */
export const noir = new NoirZcashWalletAdapter({ network: 'mainnet' });
export const walletStore = new WalletStore({ storage: null });
walletStore.registerAdapter(noir);
