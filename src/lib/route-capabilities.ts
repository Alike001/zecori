import { BASE_SEPOLIA_USDC_DESTINATION_ID, supportedDestination } from './destination-capabilities.ts';

export type RouteAvailability = 'verified-executable' | 'operator-review-required' | 'experimental-disabled' | 'research-only';
export type RouteReadinessInput = { operatorAttested: boolean; liquidityReady: boolean; termsValidUntil?: string; now?: number };
export type RouteReadiness = {
  enabled: boolean;
  operator: 'attested' | 'required';
  liquidity: 'ready' | 'missing';
  terms: 'current' | 'stale' | 'unconfigured';
  termsValidUntil?: string;
  reason: string;
};

export type RouteCapability = {
  id: string;
  availability: RouteAvailability;
  title: string;
  summary: string;
  source: { network: string; asset: string; privacy: string };
  destination: { id: string; network: string; chainId?: number; asset: string; contract?: string };
  readiness?: RouteReadiness;
  execution: {
    enabled: boolean;
    amount?: string;
    outcome?: string;
    provider?: 'trusted-testnet-liquidity-provider';
    pricing?: 'fixed-test-terms';
  };
  disclosure: string;
};

export const EXECUTABLE_ROUTE_ID = 'zcash-testnet-to-base-sepolia-fixed' as const;

export function evaluateRouteReadiness(input: RouteReadinessInput): RouteReadiness {
  const operator = input.operatorAttested ? 'attested' as const : 'required' as const;
  const liquidity = input.liquidityReady ? 'ready' as const : 'missing' as const;
  const parsedExpiry = input.termsValidUntil ? Date.parse(input.termsValidUntil) : Number.NaN;
  const terms = !input.termsValidUntil || !Number.isFinite(parsedExpiry) ? 'unconfigured' as const : parsedExpiry <= (input.now ?? Date.now()) ? 'stale' as const : 'current' as const;
  const enabled = operator === 'attested' && liquidity === 'ready' && terms === 'current';
  const reason = operator !== 'attested'
    ? 'Current operator readiness has not been attested.'
    : liquidity !== 'ready'
      ? 'Test-USDC liquidity readiness has not been attested.'
      : terms === 'stale'
        ? 'The fixed route terms have expired and require operator renewal.'
        : terms === 'unconfigured'
          ? 'The fixed route terms have no reviewed validity deadline.'
          : 'Operator, liquidity and fixed-term freshness gates are current.';
  return { enabled, operator, liquidity, terms, ...(Number.isFinite(parsedExpiry) ? { termsValidUntil: new Date(parsedExpiry).toISOString() } : {}), reason };
}

const destination = supportedDestination();
const defaultReadiness = evaluateRouteReadiness({ operatorAttested: false, liquidityReady: false });

export const ROUTE_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: EXECUTABLE_ROUTE_ID,
    availability: 'operator-review-required' as const,
    title: 'Shielded TAZ to Base Sepolia',
    summary: 'The guarded route is implemented, but requests stay closed until operator, liquidity and fixed-term freshness gates pass.',
    source: Object.freeze({ network: 'Zcash testnet', asset: 'TAZ', privacy: 'Ironwood shielded pool' }),
    destination: Object.freeze({ id: destination.id, network: destination.network.name, chainId: destination.network.chainId, asset: `test ${destination.asset.symbol}`, contract: destination.asset.contractIdentity.kind === 'erc20' ? destination.asset.contractIdentity.address : undefined }),
    readiness: Object.freeze(defaultReadiness),
    execution: Object.freeze({ enabled: false as const, amount: '0.01 TAZ', outcome: '1 test USDC', provider: 'trusted-testnet-liquidity-provider' as const, pricing: 'fixed-test-terms' as const }),
    disclosure: 'Testnet only. The Zcash source is shielded; the Base destination is public. Manual approval, temporary custody, current liquidity and non-stale terms are required.',
  }),
  Object.freeze({
    id: 'zcash-mainnet-crosschain-research',
    availability: 'research-only' as const,
    title: 'Zcash mainnet routes',
    summary: 'Research only; no executable route, quote, wallet integration or payment path exists.',
    source: Object.freeze({ network: 'Zcash mainnet', asset: 'ZEC', privacy: 'Shielded transaction research' }),
    destination: Object.freeze({ id: 'base-mainnet-usdc', network: 'Base mainnet', chainId: 8453, asset: 'USDC' }),
    execution: Object.freeze({ enabled: false as const }),
    disclosure: 'Not available. No destination contract, verifier, liquidity or operator path is configured. Do not send funds.',
  }),
  Object.freeze({
    id: 'additional-testnet-routes',
    availability: 'experimental-disabled' as const,
    title: 'Other destination networks',
    summary: 'Not available; no additional chain, asset, provider or verifier capability is configured.',
    source: Object.freeze({ network: 'Zcash testnet', asset: 'TAZ', privacy: 'No additional route assessed' }),
    destination: Object.freeze({ id: 'unconfigured', network: 'Other networks', asset: 'Unconfigured' }),
    execution: Object.freeze({ enabled: false as const }),
    disclosure: 'No quote or payment action is available until a destination is implemented and independently verified.',
  }),
]) satisfies readonly RouteCapability[];

export function routeCapabilitiesForReadiness(readiness: RouteReadiness): RouteCapability[] {
  return ROUTE_CAPABILITIES.map(route => route.id !== EXECUTABLE_ROUTE_ID ? structuredClone(route) : {
    ...structuredClone(route), readiness,
    availability: readiness.enabled ? 'verified-executable' as const : 'operator-review-required' as const,
    summary: readiness.enabled ? 'The exact testnet request path is open under current operator, liquidity and fixed-term attestations.' : readiness.reason,
    execution: { ...route.execution, enabled: readiness.enabled },
  });
}

export function executableRoute() {
  return ROUTE_CAPABILITIES.find(route => route.id === EXECUTABLE_ROUTE_ID)!;
}

export { BASE_SEPOLIA_USDC_DESTINATION_ID };
