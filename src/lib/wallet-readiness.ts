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
    discovered.set(provider, {
      id: detail?.info.uuid ?? `legacy-${discovered.size + 1}`,
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

export async function requestDestinationControlSignature(provider: Eip1193Provider | undefined, recipient: string, typedData: Record<string, unknown>): Promise<string> {
  if (!provider) throw new Error('A compatible EIP-1193 wallet is required to verify destination control. Manual addresses remain unverified.');
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const chain = await provider.request({ method: 'eth_chainId' });
  if (typeof chain !== 'string' || chain.toLowerCase() !== BASE_SEPOLIA_CHAIN_ID_HEX) throw new Error('Switch to Base Sepolia (chain 84532) and try again. The application does not switch networks automatically.');
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== recipient.toLowerCase()) throw new Error('The wallet account changed or does not match the exact destination address.');
  let signed: unknown;
  try { signed = await provider.request({ method: 'eth_signTypedData_v4', params: [accounts[0], JSON.stringify(typedData)] }); }
  catch (error) { throw new Error((error as { code?: number }).code === 4001 ? 'The wallet signature request was rejected. No destination proof was created.' : 'The wallet could not sign the destination-control message.'); }
  const [afterChain, afterAccounts] = await Promise.all([provider.request({ method: 'eth_chainId' }), provider.request({ method: 'eth_accounts' })]);
  if (typeof afterChain !== 'string' || afterChain.toLowerCase() !== BASE_SEPOLIA_CHAIN_ID_HEX || !Array.isArray(afterAccounts) || typeof afterAccounts[0] !== 'string' || afterAccounts[0].toLowerCase() !== recipient.toLowerCase()) throw new Error('The wallet network or account changed while signing. The proof was discarded.');
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
