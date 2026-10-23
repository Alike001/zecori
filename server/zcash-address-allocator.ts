import { randomUUID } from 'node:crypto';
import { walletBRpc } from './zcash-verifier.ts';
import type { RpcCall } from './rpc-client.ts';

type ChainInfo = { chain?: string; blocks?: number; headers?: number; initialblockdownload?: boolean };
type WalletInfo = { scanning?: false | object; enhanced_through?: number | null; import_error?: unknown; unlocked_until?: number };
type AddressInfo = { address?: string; ismine?: boolean; isvalid_orchard?: boolean; receiver_types?: string[]; receivers_consistent?: boolean; diversifier_index?: number | string };
type HistoryEntry = { address?: string; diversifier_index?: number | string };

export type ValidatedReceivingAddress = {
  allocationId: string;
  address: string;
  diversifierIndex: string;
  validatedAt: string;
  sourceNotBeforeHeight: number;
  state: 'AVAILABLE' | 'ASSIGNED';
  assignedOrderId?: string;
};

export const WALLET_B_ADDRESS_ALLOCATION_PLAN = Object.freeze({
  network: 'zcash-testnet',
  rpcMethodRequiringOperatorApproval: 'z_getaddressforaccount',
  account: 0,
  receiverTypes: ['orchard'] as const,
  mutationEnabled: false,
  disclosure: 'Address derivation is intentionally disabled until an operator explicitly approves a wallet-mutating RPC call.',
});

function exactInteger(value: number | string | undefined): string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value).toString() : undefined;
}

export async function validateUnusedWalletBAddress(
  address: string,
  options: { rpc?: RpcCall; allocationId?: string; now?: number } = {},
): Promise<ValidatedReceivingAddress> {
  if (!/^utest1[a-z0-9]+$/.test(address)) throw new Error('Candidate must be a complete Zcash testnet Unified Address');
  const rpc = options.rpc ?? await walletBRpc();
  const [chain, wallet, info] = await Promise.all([
    rpc<ChainInfo>('getblockchaininfo'), rpc<WalletInfo>('getwalletinfo'), rpc<AddressInfo>('getaddressinfo', [address]),
  ]);
  if (chain.chain !== 'test' || chain.initialblockdownload !== false || !Number.isSafeInteger(chain.blocks) || chain.blocks !== chain.headers) throw new Error('Wallet B is not synchronized on Zcash testnet');
  if (wallet.scanning !== false || wallet.import_error || wallet.enhanced_through !== chain.blocks) throw new Error('Wallet B history is incomplete');
  if (typeof wallet.unlocked_until !== 'number' || wallet.unlocked_until > Math.floor((options.now ?? Date.now()) / 1000)) throw new Error('Wallet B must remain encrypted and locked');
  const diversifierIndex = exactInteger(info.diversifier_index);
  if (info.address !== address || info.ismine !== true || info.isvalid_orchard !== true || info.receivers_consistent === false || !diversifierIndex) throw new Error('Candidate is not an owned consistent Orchard address');
  if (info.receiver_types?.length !== 1 || info.receiver_types[0] !== 'orchard') throw new Error('Candidate must be an Orchard-only Unified Address');

  const history: HistoryEntry[] = [];
  for (let offset = 0; offset < 10_000; offset += 100) {
    const page = await rpc<HistoryEntry[]>('z_listtransactions', [100, offset, false]);
    history.push(...page);
    if (page.length < 100) break;
  }
  if (history.some(entry => entry.address === address || exactInteger(entry.diversifier_index) === diversifierIndex)) throw new Error('Candidate receiving address or diversifier has prior wallet history');
  return {
    allocationId: options.allocationId ?? randomUUID(), address, diversifierIndex,
    validatedAt: new Date(options.now ?? Date.now()).toISOString(), sourceNotBeforeHeight: (chain.blocks as number) + 1,
    state: 'AVAILABLE',
  };
}
