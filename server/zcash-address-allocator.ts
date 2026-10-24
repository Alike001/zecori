import { randomUUID } from 'node:crypto';
import { walletBRpc, ZECD_WALLET_B_NAME } from './zcash-verifier.ts';
import { exactJsonInteger, type RpcCall } from './rpc-client.ts';

type ChainInfo = { chain?: string; blocks?: number; headers?: number; initialblockdownload?: boolean };
type WalletInfo = { walletname?: string; private_keys_enabled?: boolean; scanning?: false | object; enhanced_through?: number | null; import_error?: unknown; unlocked_until?: number };
type AddressInfo = { address?: string; ismine?: boolean; isvalid_orchard?: boolean; receiver_types?: string[]; receivers_consistent?: boolean; diversifier_index?: number | string };
type HistoryEntry = { address?: string; diversifier_index?: number | string };
type DerivedAddress = { account?: number; address?: string; diversifier_index?: number | string; receiver_types?: string[] };

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
  guardedOperatorCommandAvailable: true,
  disclosure: 'Automatic derivation is disabled; the operator-only command requires an exact order authorization and a durable PostgreSQL diversifier journal.',
});

export function exactDiversifierIndex(value: number | string | undefined): string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : undefined;
  return typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value).toString() : undefined;
}

async function inspectWalletB(rpc: RpcCall, _now: number): Promise<{ blocks: number; history: HistoryEntry[] }> {
  const [chain, wallet] = await Promise.all([
    rpc<ChainInfo>('getblockchaininfo'), rpc<WalletInfo>('getwalletinfo'),
  ]);
  if (chain.chain !== 'test' || chain.initialblockdownload !== false || !Number.isSafeInteger(chain.blocks) || chain.blocks !== chain.headers) throw new Error('Wallet B is not synchronized on Zcash testnet');
  if (wallet.walletname !== ZECD_WALLET_B_NAME || wallet.private_keys_enabled !== true) throw new Error('Wallet B identity or ownership does not match the configured spending wallet');
  if (wallet.scanning !== false || wallet.import_error || wallet.enhanced_through !== chain.blocks) throw new Error('Wallet B history is incomplete');
  if (wallet.unlocked_until !== 0) throw new Error('Wallet B must remain encrypted and locked');
  const history: HistoryEntry[] = [];
  for (let offset = 0; ; offset += 100) {
    if (offset >= 1_000_000) throw new Error('Wallet B history exceeds the safe allocation scan limit');
    const page = await rpc<HistoryEntry[]>('z_listtransactions', [100, offset, false]);
    history.push(...page);
    if (page.length < 100) break;
  }
  return { blocks: chain.blocks as number, history };
}

export async function validateUnusedWalletBDiversifier(
  diversifierIndex: string,
  options: { rpc?: RpcCall; now?: number } = {},
): Promise<void> {
  const exact = exactDiversifierIndex(diversifierIndex);
  if (exact === undefined) throw new Error('Diversifier index must be an unsigned decimal integer');
  const rpc = options.rpc ?? await walletBRpc();
  const { history } = await inspectWalletB(rpc, options.now ?? Date.now());
  if (history.some(entry => exactDiversifierIndex(entry.diversifier_index) === exact)) throw new Error('Diversifier index has prior wallet payment history');
}

export async function deriveExactOrchardAddress(diversifierIndex: string, rpc: RpcCall): Promise<{ address: string; diversifierIndex: string }> {
  const exact = exactDiversifierIndex(diversifierIndex);
  if (exact === undefined) throw new Error('Journaled diversifier index is invalid');
  const derived = await rpc<DerivedAddress>('z_getaddressforaccount', [0, ['orchard'], exactJsonInteger(exact)]);
  const returnedIndex = exactDiversifierIndex(derived.diversifier_index);
  if (derived.account !== 0 || !derived.address || !/^utest1[a-z0-9]+$/.test(derived.address) || returnedIndex !== exact
    || derived.receiver_types?.length !== 1 || derived.receiver_types[0] !== 'orchard') {
    throw new Error('Derived address response does not match the journaled Orchard allocation');
  }
  return { address: derived.address, diversifierIndex: returnedIndex };
}

export async function validateUnusedWalletBAddress(
  address: string,
  options: { rpc?: RpcCall; allocationId?: string; now?: number } = {},
): Promise<ValidatedReceivingAddress> {
  if (!/^utest1[a-z0-9]+$/.test(address)) throw new Error('Candidate must be a complete Zcash testnet Unified Address');
  const rpc = options.rpc ?? await walletBRpc();
  const [{ blocks, history }, info] = await Promise.all([
    inspectWalletB(rpc, options.now ?? Date.now()), rpc<AddressInfo>('getaddressinfo', [address]),
  ]);
  const diversifierIndex = exactDiversifierIndex(info.diversifier_index);
  if (info.address !== address || info.ismine !== true || info.isvalid_orchard !== true || info.receivers_consistent === false || !diversifierIndex) throw new Error('Candidate is not an owned consistent Orchard address');
  if (info.receiver_types?.length !== 1 || info.receiver_types[0] !== 'orchard') throw new Error('Candidate must be an Orchard-only Unified Address');

  if (history.some(entry => entry.address === address || exactDiversifierIndex(entry.diversifier_index) === diversifierIndex)) throw new Error('Candidate receiving address or diversifier has prior wallet history');
  return {
    allocationId: options.allocationId ?? randomUUID(), address, diversifierIndex,
    validatedAt: new Date(options.now ?? Date.now()).toISOString(), sourceNotBeforeHeight: blocks + 1,
    state: 'AVAILABLE',
  };
}
