import { isDeepStrictEqual } from 'node:util';
import { PUBLIC_ROUTE_TERMS } from './public-order-store.ts';

export const PUBLIC_ROUTE_ID = 'zcash-testnet-to-base-sepolia-fixed' as const;

export const PUBLIC_ROUTE_REGISTRY = Object.freeze([
  Object.freeze({
    id: PUBLIC_ROUTE_ID,
    kind: 'fixed-test-terms' as const,
    terms: PUBLIC_ROUTE_TERMS,
    disclosures: Object.freeze({
      testOnly: true as const,
      liveMarketQuote: false as const,
      spendingAuthority: false as const,
      createsOrder: false as const,
      authorizesPayment: false as const,
    }),
  }),
]);

export type RegisteredPublicRoute = (typeof PUBLIC_ROUTE_REGISTRY)[number];
export type SupportedRoutesToolResult = {
  routes: readonly RegisteredPublicRoute[];
  liveMarketQuotes: false;
};

export function supportedRoutesToolResult(): SupportedRoutesToolResult {
  return structuredClone({ routes: PUBLIC_ROUTE_REGISTRY, liveMarketQuotes: false });
}

export function validateSupportedRoutesToolResult(value: unknown): SupportedRoutesToolResult {
  const expected = supportedRoutesToolResult();
  if (!isDeepStrictEqual(value, expected)) throw new Error('Supported-route tool output does not match the deterministic route registry.');
  return value as SupportedRoutesToolResult;
}

export function registeredRouteIds(): readonly string[] {
  return PUBLIC_ROUTE_REGISTRY.map(route => route.id);
}
