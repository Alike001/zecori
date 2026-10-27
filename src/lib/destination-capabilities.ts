import { BASE_USDC } from './order-coordinator.ts';

export const BASE_SEPOLIA_USDC_DESTINATION_ID = 'base-sepolia-usdc' as const;

export type DestinationCapability = {
  id: string;
  status: 'supported' | 'disabled';
  network: { id: string; name: string; environment: 'testnet' | 'mainnet'; chainId: number };
  asset: {
    symbol: string;
    name: string;
    decimals?: number;
    contractIdentity: { kind: 'erc20'; address: string } | { kind: 'unconfigured' };
  };
  verifier: { kind: 'base-erc20-transfer' | 'unavailable'; implemented: boolean; minimumConfirmations?: number };
  readiness: {
    operator: 'attestation-required' | 'unavailable';
    liquidity: 'attestation-required' | 'unavailable';
  };
  disclosure: string;
};

export const DESTINATION_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: BASE_SEPOLIA_USDC_DESTINATION_ID,
    status: 'supported' as const,
    network: Object.freeze({ id: 'base-sepolia', name: 'Base Sepolia', environment: 'testnet' as const, chainId: 84532 }),
    asset: Object.freeze({ symbol: 'USDC', name: 'Circle test USDC', decimals: 6, contractIdentity: Object.freeze({ kind: 'erc20' as const, address: BASE_USDC }) }),
    verifier: Object.freeze({ kind: 'base-erc20-transfer' as const, implemented: true, minimumConfirmations: 3 }),
    readiness: Object.freeze({ operator: 'attestation-required' as const, liquidity: 'attestation-required' as const }),
    disclosure: 'The Base destination is public. Recipient, amount, token and transaction evidence are visible on Base Sepolia.',
  }),
  Object.freeze({
    id: 'base-mainnet-usdc',
    status: 'disabled' as const,
    network: Object.freeze({ id: 'base-mainnet', name: 'Base mainnet', environment: 'mainnet' as const, chainId: 8453 }),
    asset: Object.freeze({ symbol: 'USDC', name: 'USDC', contractIdentity: Object.freeze({ kind: 'unconfigured' as const }) }),
    verifier: Object.freeze({ kind: 'unavailable' as const, implemented: false }),
    readiness: Object.freeze({ operator: 'unavailable' as const, liquidity: 'unavailable' as const }),
    disclosure: 'Not available. No contract identity, verifier, liquidity or operator path is configured for mainnet.',
  }),
]) satisfies readonly DestinationCapability[];

export function supportedDestination(): DestinationCapability {
  return structuredClone(DESTINATION_CAPABILITIES.find(item => item.id === BASE_SEPOLIA_USDC_DESTINATION_ID)!);
}

export function validateDestinationCapability(input: { network: unknown; chainId: unknown; contract: unknown }): DestinationCapability {
  const network = DESTINATION_CAPABILITIES.find(item => item.network.id === input.network);
  if (!network) throw Object.assign(new Error('The destination network is not configured.'), { code: 'UNSUPPORTED_DESTINATION_NETWORK' });
  if (network.network.chainId !== input.chainId) throw Object.assign(new Error('The destination network and chain ID do not match.'), { code: 'DESTINATION_CHAIN_MISMATCH' });
  if (network.status !== 'supported' || !network.verifier.implemented) throw Object.assign(new Error('The destination is not available for requests.'), { code: 'DESTINATION_DISABLED' });
  if (network.asset.contractIdentity.kind !== 'erc20' || network.asset.contractIdentity.address !== input.contract) {
    throw Object.assign(new Error('The destination asset contract does not match the supported route.'), { code: 'DESTINATION_ASSET_MISMATCH' });
  }
  return structuredClone(network);
}
