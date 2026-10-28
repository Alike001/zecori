export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_SEPOLIA_CHAIN_ID_HEX = '0x14a34';

export type WalletChoice = 'unselected' | 'connected-read-only' | 'external';

export type ZcashReadOnlyCapabilities = {
  protocol: 'zecathon-zcash-readonly-v1';
  network: 'zcash-testnet' | string;
  pool: 'ironwood' | string;
  readOnly: boolean;
};

export type ZcashReadOnlyAdapter = {
  getCapabilities(): Promise<unknown>;
};

export type Eip1193Provider = {
  request(arguments_: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
  isMetaMask?: boolean;
  providers?: Eip1193Provider[];
  on?(event: 'accountsChanged' | 'chainChanged' | 'disconnect', listener: (...arguments_: unknown[]) => void): void;
  removeListener?(event: 'accountsChanged' | 'chainChanged' | 'disconnect', listener: (...arguments_: unknown[]) => void): void;
};

export type InjectedWalletProvider = {
  id: string;
  name: string;
  rdns?: string;
  provider: Eip1193Provider;
  isMetaMask: boolean;
};

type Eip6963ProviderDetail = {
  info: { uuid: string; name: string; rdns: string };
  provider: Eip1193Provider;
};

export function subscribeInjectedWalletProviders(
  browser: Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'> & { ethereum?: Eip1193Provider },
  onChange: (providers: InjectedWalletProvider[]) => void,
): () => void {
  const discovered = new Map<Eip1193Provider, InjectedWalletProvider>();
  const publish = () => onChange([...discovered.values()]);
  const add = (provider: Eip1193Provider, detail?: Eip6963ProviderDetail) => {
    const rdns = detail?.info.rdns;
    const existing = discovered.get(provider);
    discovered.set(provider, {
      // Keep the UI identity stable if an EIP-6963 announcement arrives after
      // the same provider was found through the legacy injection fallback.
      id: existing?.id ?? detail?.info.uuid ?? `legacy-${discovered.size + 1}`,
      name: detail?.info.name ?? (provider.isMetaMask ? 'MetaMask' : `Injected wallet ${discovered.size + 1}`),
      ...(rdns ? { rdns } : {}),
      provider,
      isMetaMask: rdns === 'io.metamask' || rdns === 'io.metamask.flask' || provider.isMetaMask === true,
    });
    publish();
  };
  const announced = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (detail?.provider && detail.info?.uuid && detail.info?.name && detail.info?.rdns) add(detail.provider, detail);
  };
  browser.addEventListener('eip6963:announceProvider', announced as EventListener);
  const legacy = browser.ethereum?.providers?.length ? browser.ethereum.providers : browser.ethereum ? [browser.ethereum] : [];
  legacy.forEach(provider => add(provider));
  browser.dispatchEvent(new Event('eip6963:requestProvider'));
  return () => browser.removeEventListener('eip6963:announceProvider', announced as EventListener);
}

export type WalletReadiness = {
  ready: boolean;
  code: 'READY' | 'NOT_DETECTED' | 'UNSUPPORTED_ADAPTER' | 'UNSUPPORTED_NETWORK' | 'UNSUPPORTED_POOL' | 'NO_ACCOUNT' | 'INVALID_ACCOUNT' | 'UNAVAILABLE';
  message: string;
  account?: string;
};

export function isBaseAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
}

export function sameEvmAddress(left: string, right: string): boolean {
  try { return normalizeEvmAddress(left) === normalizeEvmAddress(right); }
  catch { return false; }
}

function requestedAccount(accounts: unknown, recipient: string): string {
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') {
    throw new Error('The selected wallet did not provide an account. Unlock it, choose the receiving account, and try again.');
  }
  let account: string;
  try { account = normalizeEvmAddress(accounts[0]); }
  catch { throw new Error('The selected wallet returned an invalid account address. The proof was not created.'); }
  if (!sameEvmAddress(account, recipient)) {
    throw new Error('The selected wallet account does not match the reviewed receiving address. Choose the exact receiving account and try again.');
  }
  return account;
}

export async function requestDestinationControlSignature(provider: Eip1193Provider | undefined, recipient: string, typedData: Record<string, unknown>): Promise<string> {
  if (!provider) throw new Error('A compatible EIP-1193 wallet is required to verify destination control. Manual addresses remain unverified.');
  try { normalizeEvmAddress(recipient); }
  catch { throw new Error('The reviewed receiving address is invalid. Refresh the request before trying again.'); }
  let accounts: unknown;
  try { accounts = await provider.request({ method: 'eth_requestAccounts' }); }
  catch (error) {
    if ((error as { code?: number }).code === 4001) throw new Error('Wallet account access was rejected. No destination proof was created.');
    throw new Error('The selected wallet could not provide an account. Unlock it and try again.');
  }
  let chain: unknown;
  try { chain = await provider.request({ method: 'eth_chainId' }); }
  catch { throw new Error('The selected wallet could not report its network. No destination proof was created.'); }
  if (typeof chain !== 'string' || chain.toLowerCase() !== BASE_SEPOLIA_CHAIN_ID_HEX) throw new Error('Switch to Base Sepolia (chain 84532) and try again. The application does not switch networks automatically.');
  const account = requestedAccount(accounts, recipient);
  let signed: unknown;
  try { signed = await provider.request({ method: 'eth_signTypedData_v4', params: [account, JSON.stringify(typedData)] }); }
  catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 4001) throw new Error('The wallet signature request was rejected. No destination proof was created.');
    if (code === -32601 || code === 4200) throw new Error('The selected wallet does not support EIP-712 typed-data signing. Use a compatible wallet for this receiving address.');
    throw new Error('The selected wallet could not sign the destination-control message. Check that it is unlocked and try again.');
  }
  let afterChain: unknown; let afterAccounts: unknown;
  try { [afterChain, afterAccounts] = await Promise.all([provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' })]); }
  catch { throw new Error('The selected wallet could not be rechecked after signing. The proof was discarded.'); }
  if (typeof afterChain !== 'string' || afterChain.toLowerCase() !== BASE_SEPOLIA_CHAIN_ID_HEX) throw new Error('The selected wallet network changed while signing. The proof was discarded.');
  try { requestedAccount(afterAccounts, recipient); }
  catch { throw new Error('The selected wallet account changed while signing. The proof was discarded.'); }
  if (typeof signed !== 'string' || !/^0x[0-9a-f]+$/i.test(signed)) throw new Error('The wallet returned an invalid signature.');
  return signed;
}

export function validateManualBaseRecipient(value: string): WalletReadiness {
  const address = value.trim();
  if (!address) return { ready: false, code: 'NO_ACCOUNT', message: 'Enter a Base Sepolia receiving address.' };
  try {
    const normalized = normalizeEvmAddress(address);
    return { ready: true, code: 'READY', message: 'Address format and EIP-55 checksum are valid. Destination control is unverified until this exact wallet signs.', account: normalized };
  } catch { return { ready: false, code: 'INVALID_ACCOUNT', message: 'Enter a complete, non-zero address with a valid mixed-case EIP-55 checksum.' }; }
}

export async function inspectZcashReadOnlyAdapter(adapter: ZcashReadOnlyAdapter | undefined): Promise<WalletReadiness> {
  if (!adapter || typeof adapter.getCapabilities !== 'function') {
    return { ready: false, code: 'NOT_DETECTED', message: 'No reviewed Zcash read-only browser adapter was detected.' };
  }
  try {
    const raw = await adapter.getCapabilities();
    if (!raw || typeof raw !== 'object') return { ready: false, code: 'UNSUPPORTED_ADAPTER', message: 'The Zcash adapter returned invalid capabilities.' };
    const capabilities = raw as Partial<ZcashReadOnlyCapabilities>;
    if (capabilities.protocol !== 'zecathon-zcash-readonly-v1' || capabilities.readOnly !== true) {
      return { ready: false, code: 'UNSUPPORTED_ADAPTER', message: 'This adapter is not approved for read-only Zecori access.' };
    }
    if (capabilities.network !== 'zcash-testnet') return { ready: false, code: 'UNSUPPORTED_NETWORK', message: 'Switch the Zcash wallet to testnet. Mainnet is not supported.' };
    if (capabilities.pool !== 'ironwood') return { ready: false, code: 'UNSUPPORTED_POOL', message: 'Only Ironwood shielded source funds are supported.' };
    return { ready: true, code: 'READY', message: 'Zcash testnet and Ironwood read-only capabilities verified.' };
  } catch {
    return { ready: false, code: 'UNAVAILABLE', message: 'The Zcash wallet did not provide verifiable read-only capabilities.' };
  }
}

export async function inspectBaseReadOnlyProvider(provider: Eip1193Provider | undefined): Promise<WalletReadiness> {
  if (!provider || typeof provider.request !== 'function') return { ready: false, code: 'NOT_DETECTED', message: 'No EIP-1193 Base wallet provider was detected.' };
  try {
    const chainId = await provider.request({ method: 'eth_chainId' });
    if (typeof chainId !== 'string' || chainId.toLowerCase() !== BASE_SEPOLIA_CHAIN_ID_HEX) {
      return { ready: false, code: 'UNSUPPORTED_NETWORK', message: 'Switch the wallet to Base Sepolia (chain 84532). No network switch was requested.' };
    }
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return { ready: false, code: 'NO_ACCOUNT', message: 'No already-authorized account is available. This site will not request wallet permissions yet.' };
    }
    const account = accounts[0];
    if (typeof account !== 'string') return { ready: false, code: 'INVALID_ACCOUNT', message: 'The wallet returned an invalid Base account.' };
    try { return { ready: true, code: 'READY', message: 'Base Sepolia address detected read-only. Destination control is still unverified; no signature was requested.', account: normalizeEvmAddress(account) }; }
    catch { return { ready: false, code: 'INVALID_ACCOUNT', message: 'The wallet returned an invalid or incorrectly checksummed Base account.' }; }
  } catch {
    return { ready: false, code: 'UNAVAILABLE', message: 'The Base wallet could not be checked read-only.' };
  }
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    zecathonZcashReadOnly?: ZcashReadOnlyAdapter;
  }
}
import { normalizeEvmAddress } from './evm-address.ts';
