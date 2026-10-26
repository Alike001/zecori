import type { RouteAvailability } from './route-capabilities.ts';

export type RouteExplanationCard = {
  kind: 'route-explanation'; routeId: string; title: string; classification: 'fixed-test-terms';
  source: { network: string; asset: string; amount: string; amountZatoshis: string; pool: string };
  destination: { network: string; asset: string; amount: string; amountAtomic: string; chainId: number; contract: string };
  provider: { id: string; model: string };
  pricing: { description: string; sourceAtomicUnits: string; destinationAtomicUnits: string };
  privacy: string; custody: string;
  disclosures: { testOnly: true; liveMarketQuote: false; spendingAuthority: false; createsOrder: false; authorizesPayment: false };
};

export type RouteAvailabilityCard = {
  kind: 'route-availability';
  routes: Array<{ routeId: string; title: string; availability: RouteAvailability; enabled: boolean }>;
};

export type QuoteComparisonCard = {
  kind: 'quote-comparison'; available: false; reason: string;
  fixedTestTerms: { routeId: string; source: string; destination: string; marketQuote: false };
};

export type ReviewPreparationCard = {
  kind: 'review-preparation'; routeId: string; exactTerms: string; checklist: string[];
  createsOrder: false; authorizesPayment: false; signsTransaction: false;
};

export type OrderStatusCard = {
  kind: 'order-status'; requestId: string; status: string; createdAt: string; expiresAt: string;
  receiptAvailable: boolean; timeline: Array<{ type: string; at: string; actor: string }>;
};

export type FailureRecoveryCard = {
  kind: 'failure-recovery'; requestId: string; status: string; failureCode: string; guidance: string;
};

export type AgentFactCard = RouteExplanationCard | RouteAvailabilityCard | QuoteComparisonCard | ReviewPreparationCard | OrderStatusCard | FailureRecoveryCard;
