export type RouteAvailability = 'verified-executable' | 'operator-review-required' | 'experimental-disabled' | 'research-only';

export type RouteCapability = {
  id: string;
  availability: RouteAvailability;
  title: string;
  summary: string;
  source: { network: string; asset: string; privacy: string };
  destination: { network: string; asset: string };
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

export const ROUTE_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: EXECUTABLE_ROUTE_ID,
    availability: 'operator-review-required' as const,
    title: 'Shielded TAZ to Base Sepolia',
    summary: 'The guarded route is implemented, but requests stay closed until an operator attests current testnet provider readiness.',
    source: Object.freeze({ network: 'Zcash testnet', asset: 'TAZ', privacy: 'Ironwood shielded pool' }),
    destination: Object.freeze({ network: 'Base Sepolia', asset: 'test USDC' }),
    execution: Object.freeze({ enabled: false as const, amount: '0.01 TAZ', outcome: '1 test USDC', provider: 'trusted-testnet-liquidity-provider' as const, pricing: 'fixed-test-terms' as const }),
    disclosure: 'Testnet only. Exploration is public; request creation requires an explicit deployment-time readiness attestation. Fixed terms, manual approval, temporary custody, and no automatic refund.',
  }),
  Object.freeze({
    id: 'zcash-mainnet-crosschain-research',
    availability: 'research-only' as const,
    title: 'Zcash mainnet routes',
    summary: 'Research only; no executable route, quote, wallet integration, or payment path exists.',
    source: Object.freeze({ network: 'Zcash mainnet', asset: 'ZEC', privacy: 'Shielded transaction research' }),
    destination: Object.freeze({ network: 'Unspecified', asset: 'Unspecified' }),
    execution: Object.freeze({ enabled: false as const }),
    disclosure: 'Do not send funds. Mainnet execution is not available.',
  }),
  Object.freeze({
    id: 'additional-testnet-routes',
    availability: 'experimental-disabled' as const,
    title: 'Additional testnet routes',
    summary: 'Reserved for future verified integrations; no token, amount, provider, or wallet support is claimed.',
    source: Object.freeze({ network: 'Unspecified testnet', asset: 'Unspecified', privacy: 'Not yet assessed' }),
    destination: Object.freeze({ network: 'Unspecified testnet', asset: 'Unspecified' }),
    execution: Object.freeze({ enabled: false as const }),
    disclosure: 'Disabled until implementation, security review, and independent settlement verification are complete.',
  }),
]) satisfies readonly RouteCapability[];

export function routeCapabilitiesForRequestState(requestsEnabled: boolean): RouteCapability[] {
  return ROUTE_CAPABILITIES.map(route => route.id !== EXECUTABLE_ROUTE_ID || !requestsEnabled ? structuredClone(route) : {
    ...structuredClone(route),
    availability: 'verified-executable' as const,
    summary: 'The guarded testnet request path is open after an explicit operator readiness attestation.',
    execution: { ...route.execution, enabled: true },
  });
}

export function executableRoute() {
  return ROUTE_CAPABILITIES.find(route => route.id === EXECUTABLE_ROUTE_ID)!;
}
