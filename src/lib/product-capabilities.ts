import { ROUTE_CAPABILITIES } from './route-capabilities.ts';

export const FEATURE_STATUSES = ['VERIFIED', 'EXPERIMENTAL', 'DISABLED', 'PLANNED'] as const;
export type FeatureStatus = typeof FEATURE_STATUSES[number];

export type ProductCapability = {
  id: string;
  title: string;
  status: FeatureStatus;
  summary: string;
  evidence: string;
};

export const PRODUCT_CAPABILITIES = Object.freeze([
  { id: 'guest-exploration', title: 'Guest route exploration', status: 'VERIFIED', summary: 'Public route terms and boundaries are available without an account.', evidence: 'Browser smoke and public capability API.' },
  { id: 'passkey-auth', title: 'Passkey accounts and recovery', status: 'VERIFIED', summary: 'Multiple passkeys, rotating sessions, revocation, CSRF, and owner isolation are implemented.', evidence: 'WebAuthn smoke and PostgreSQL integration tests.' },
  { id: 'privy-auth', title: 'Privy email and Google authentication', status: 'DISABLED', summary: 'Integration is feature-flagged off pending credentials, live acceptance, and a clean supported dependency graph.', evidence: 'Server token/linking tests pass; live tenant validation and Zod remediation remain blocked.' },
  { id: 'fixed-test-route', title: 'Fixed Zcash testnet route', status: 'EXPERIMENTAL', summary: 'The guarded 0.01 TAZ to 1 test USDC path is implemented but fails closed until operator readiness is explicitly attested; the first linked funded test remains NO-GO.', evidence: `${ROUTE_CAPABILITIES.find(route => route.id === 'zcash-testnet-to-base-sepolia-fixed')?.id ?? 'Route registry missing'}.` },
  { id: 'noir-wallet', title: 'Noir Wallet SDK connection', status: 'EXPERIMENTAL', summary: 'Official SDK detection, silent authorized restore, explicit consent, private in-browser balance inspection, account-change invalidation, and shielded-only payment preparation are implemented. Sending remains disabled because SDK 0.1.9 cannot attest the installed testnet artifact or Ironwood pool.', evidence: 'SDK 0.1.9 and extension 1.0.40 contract tests; official testnet extension browser acceptance remains required.' },
  { id: 'destination-proof', title: 'Destination ownership proof', status: 'EXPERIMENTAL', summary: 'EIP-712 EOA proof is enforced in source and tests; broader live wallet validation remains gated.', evidence: 'Destination challenge integration and browser rejection tests.' },
  { id: 'order-lifecycle', title: 'Order lifecycle and recovery states', status: 'VERIFIED', summary: 'Backend-controlled states, immutable manifests, audit history, and terminal recovery states are implemented.', evidence: 'PostgreSQL lifecycle and operator-control tests.' },
  { id: 'receipts', title: 'Private and redacted receipts', status: 'VERIFIED', summary: 'Owner-only full receipts and public redacted receipts are separated.', evidence: 'Receipt and cross-account authorization tests.' },
  { id: 'live-quotes', title: 'Live market quotes', status: 'DISABLED', summary: 'No quote provider or comparison feed is configured.', evidence: 'Agent quote tool returns an explicit unavailable result.' },
  { id: 'automated-settlement', title: 'Automatic settlement and refunds', status: 'DISABLED', summary: 'The public app cannot allocate, sign, broadcast, approve payouts, or promise refunds.', evidence: 'Public API surface and read-only security gate.' },
  { id: 'mainnet', title: 'Mainnet routes', status: 'DISABLED', summary: 'No mainnet route, token, provider, or wallet path is enabled.', evidence: 'Canonical route registry.' },
  { id: 'ai-limited', title: 'Deterministic route assistant', status: 'VERIFIED', summary: 'Limited mode explains registered facts without an external model.', evidence: 'Agent gateway unit and API tests.' },
  { id: 'ai-groq', title: 'Groq-backed assistant', status: 'EXPERIMENTAL', summary: 'A bounded, stateless adapter exists but requires credentials and explicit external-call approval.', evidence: 'Provider contract tests; no approved live credentials in this review.' },
  { id: 'voice', title: 'Opt-in Groq speech', status: 'EXPERIMENTAL', summary: 'Authenticated recording, transcript correction, multilingual transcription, and English/Arabic output are implemented behind a disabled-by-default provider gate.', evidence: 'Speech contract/API/UI tests; real microphone, pronunciation, model availability, and account quota validation remain human acceptance tasks.' },
  { id: 'brand-exploration', title: 'Provisional Zecori identity', status: 'EXPERIMENTAL', summary: 'The customer-facing name, route/origin mark, palettes, favicon, navigation, documentation, and receipts use one system.', evidence: 'Active UI assets and brand guidelines; legal and domain clearance remain open.' },
  { id: 'handles', title: '@handles and private contacts', status: 'EXPERIMENTAL', summary: 'Optional unique handles, exact-match opt-in discovery, encrypted contacts, and non-paying route request intents are implemented. Payment-by-handle remains disabled.', evidence: 'Migration 010, PostgreSQL concurrency/isolation tests, and account UI acceptance.' },
  { id: 'inbox', title: 'In-app transactional inbox', status: 'EXPERIMENTAL', summary: 'A durable redacted outbox materializes owner-scoped read/unread items from committed account and order events.', evidence: 'Migration 010, order-event triggers, replay/restart integration tests, and inbox UI acceptance.' },
  { id: 'email-notifications', title: 'Opt-in email notifications', status: 'PLANNED', summary: 'Email follows an accepted in-app inbox and explicit consent; no sender is configured.', evidence: 'Milestone 08B notifications specification.' },
  { id: 'settings', title: 'Account settings', status: 'PLANNED', summary: 'The navigation location is reserved; no mutable preference service exists.', evidence: 'No settings API or migration exists.' },
] satisfies readonly ProductCapability[]);

export function productCapability(id: string): ProductCapability {
  const capability = PRODUCT_CAPABILITIES.find(item => item.id === id);
  if (!capability) throw new Error(`Unknown product capability: ${id}`);
  return capability;
}
