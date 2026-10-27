# Milestone 08B — Review ready

Status: `08B_REVIEW_READY`

Source boundary: preserved 08A review work on `feat/milestone-08a-consumer-privy`, based on immutable 07A commit `d90abbd3d8ec5a542516305e0576ff3427e1b622`. No commit, push, deployment, durable-staging access, or wallet operation was performed.

## Product and documentation

- Added a consistent responsive product shell for Routes, Account, Activity, AI assistant, and Docs. Inbox and Settings appear only as non-interactive planned destinations.
- Retained the original public identity and five-second shielded-Zcash explanation; added accessible docs navigation, active-page states, a branded 404, meaningful hover/press transitions, scroll-entry motion, and a complete `prefers-reduced-motion` override.
- Added 13 navigable documentation chapters: Getting Started, Wallets and Authentication, Swap and Bridge, Route Availability, Privacy and Custody, AI Agent, Receipts, Order Recovery, Security, API and Architecture, Judge Walkthrough, Evidence, and Roadmap.
- Added a typed product capability registry exposed by the public capability API and consumed by the docs UI. Route claims still derive from the canonical route registry.
- Added implementation-ready, non-shipping designs for optional handles/private contacts and a transactional outbox/inbox.
- Expanded the AI gateway to application-rendered typed cards for route explanation, route availability, verified-quote unavailability, review preparation, owner-authorized order status, and failure recovery.

The redesign skill guided the targeted shell, typography, responsive navigation, non-generic documentation layout, interaction states, 404, and reduced-motion treatment without replacing the existing React/CSS stack or swap implementation.

No canonical Kawase URL or artifact was supplied or present in the repository, and targeted public search did not produce a reliable matching product. The implementation therefore uses only the requested general usability principles—clear route selection, review, activity, documentation, and capability labeling—and copies no external source, copy, branding, or visual asset.

## Feature truth matrix

| Feature | Status | Current truth |
|---|---|---|
| Guest route exploration | VERIFIED | Public route terms and boundaries need no account. |
| Passkey accounts/recovery | VERIFIED | Multiple passkeys, sessions, revocation, CSRF, and owner isolation pass tests. |
| Privy email/Google | DISABLED | Server verification/linking tests pass; credentials, live acceptance, and dependency remediation are absent. |
| 0.01 TAZ → 1 test USDC | TEST-ONLY/PENDING LIVE VALIDATION | Implemented guarded route; first linked funded swap remains NO-GO. |
| Destination ownership proof | TEST-ONLY/PENDING LIVE VALIDATION | Enforced EIP-712 path and tests; broader live-wallet validation remains gated. |
| Backend order lifecycle | VERIFIED | PostgreSQL state, manifests, audit, recovery, and verification gates pass. |
| Private/redacted receipts | VERIFIED | Owner-private and public-redacted forms are separated and tested. |
| Live market quotes | DISABLED | No quote provider exists; fixed test terms are not a quote. |
| Automatic settlement/refunds | DISABLED | No public signing, broadcast, allocation, approval, payout, or refund mutation. |
| Mainnet | DISABLED | No mainnet route or financial path. |
| Deterministic assistant | VERIFIED | Limited mode returns registered facts without an external model. |
| Groq-backed assistant | TEST-ONLY/PENDING LIVE VALIDATION | Adapter and policy tests pass; credentials and explicit approval are absent. |
| Voice | DISABLED | Policy state machine only; no provider or UI activation. |
| @handles/private contacts | PLANNED | Reviewed schema/API contract only; no directory or resolution endpoint. |
| In-app inbox | PLANNED | Reviewed outbox/inbox contract only; no notification records. |
| Opt-in email | PLANNED | Must follow in-app acceptance and verified consent; no sender exists. |
| Settings | PLANNED | Navigation location only; no preferences API or migration. |

The machine-readable source is `src/lib/product-capabilities.ts`. Tests reject unknown truth statuses and disabled/planned “available now” or “shipped” wording.

## Privy security disposition

Current official Privy documentation confirms server-side signature, expiry, issuer, and audience verification and supports disabling automatic wallet creation. The installed current published packages are `@privy-io/react-auth@3.51.0` and `@privy-io/node@0.36.0`.

The production audit finds vulnerable Zod `3.25.76` through `@privy-io/react-auth > @base-org/account > ox > abitype` and Zod `3.22.4` through `@privy-io/react-auth > @walletconnect/ethereum-provider > @reown/appkit > @reown/appkit-wallet`. The GitHub-reviewed [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) affects `<4.6.6`; the only patched line is Zod 4.6.6+, while the affected packages declare Zod 3. A forced major override is not a compatible supported fix.

Disposition: fail closed. Privy remains `DISABLED` in the product truth matrix and off by default at runtime. No credentials exist and no live Privy browser test was attempted. Embedded wallet creation, wallet UI, delegated actions, and server signing remain off. Re-enable release review only after Privy publishes a compatible graph, `pnpm audit --prod --audit-level high` clears, CSP is retested, and real email/Google isolation acceptance passes.

## @handle, contact, and notification plans

- [Optional @handles and private contacts](handles-and-contacts-plan.md) defines normalization, reserved names, concurrency, anti-enumeration, UUID-account recovery, immutable destination versions, owner authorization, private contacts, generic errors, and an opaque future resolution token. It explicitly forbids Zcash receiver/viewing-key publication and payment-by-handle before verified rail enforcement.
- [Transactional outbox and private inbox](notifications-plan.md) defines atomic outbox persistence, recipient isolation, idempotent inbox materialization, read/unread state, leases, capped retries, dead-letter behavior, event-specific redaction, and truthful status wording. Email stays planned and opt-in.

No migration or endpoint for either design was added.

## AI integration contract

The [AI route integration contract](ai-route-integration-contract.md) applies to chat and future voice. Cards come from typed application code, never model parsing. Public tools cannot mutate; private tools re-check owner authorization. New regression coverage proves that card payloads exclude private receiver/evidence data and that quote/review cards carry `createsOrder: false` and `authorizesPayment: false`.

## Verification results

Completed 2026-10-26 against a new PostgreSQL 17 tmpfs container and synthetic browser identities:

- Migrations 001–009: passed.
- Full unit/API/PostgreSQL suite: 164 tests; 162 passed, 0 failed, 2 skipped.
- Skips: the opt-in read-only Base reference-transaction experiment and opt-in read-only Zcash Experiment 03. No real-chain calls were made.
- Typecheck: passed.
- Production build: passed. The dynamically loaded optional Privy chunk remains 1,576.11 kB / 441.34 kB gzip and triggers Vite’s 500 kB advisory.
- Browser and accessibility smoke: passed (`MILESTONE_08B_BROWSER_A11Y_SMOKE_PASSED`) for guest exploration, docs navigation, semantic landmarks, reduced motion, mobile width, wrong network/address rejection, cross-account isolation, withheld receiver, and premature-payment prevention.
- WebAuthn smoke: passed (`PASSKEY_BROWSER_SMOKE_PASSED`) with two passkeys, session revocation, re-login, owner history, and unverified-destination blocking.
- Privacy scan: passed; no operator stores, configuration, or credential patterns were found in frontend assets.
- Read-only security gate: passed; no financial execution methods or frontend logging were introduced.
- Durable staging static gate: all 27 checks passed (`DURABLE_STAGING_STATIC_READY`); durable staging was not accessed.
- Production static preflight: all 13 substantive controls passed; overall status is intentionally blocked because review work is on a feature branch with an uncommitted diff.
- `git diff --check`: passed.
- Dependency audit: blocked by two high Zod findings described above; three moderate findings also remain in the optional Privy graph.

Not run: real Privy email/Google users, external Groq calls, real wallets, live Base/Zcash experiments, funded orders, source payments, address allocation, payouts, refunds, email, inbox delivery, handles, mainnet, durable staging, deployment, or push.

## 08B changed files

- Product/docs UI: `src/ProductSurfaces.tsx`, `src/App.tsx`, `src/styles.css`, `src/lib/docs-content.ts`.
- Capability truth: `src/lib/product-capabilities.ts`, `src/lib/product-capabilities.test.ts`, `src/lib/order-api.ts`, `server/public-api.ts`, `server/app-server.test.ts`.
- Typed AI cards: `src/lib/agent-cards.ts`, `server/agent-gateway.ts`, `server/agent-gateway.test.ts`, `scripts/validate-live-groq.ts`.
- Browser/a11y regression: `scripts/milestone-06a-browser-smoke.mjs`, `package.json`.
- Research and review artifacts: `.thoughts/research/2026-10-26-milestone-08b-reality.md`, `README.md`, `docs/handles-and-contacts-plan.md`, `docs/notifications-plan.md`, `docs/ai-route-integration-contract.md`, `docs/milestone-08b-review-ready.md`.

All earlier 08A modified and untracked files remain preserved in the same working tree.

## Judge walkthrough

1. Open `/` and identify the product, shielded source, exact test terms, and custody boundary in under five seconds.
2. Open Docs → Route Availability and Evidence. Compare registry classifications and the feature truth matrix.
3. Open Routes. Show guest exploration, read-only wallet checks, exact destination confirmation, account boundary, and the purpose-limited proof step.
4. Open Account and Activity. Show passkey recovery and owner-only empty/history states.
5. Open AI assistant. Ask for the route or quote; inspect typed route/availability cards and explicit quote unavailability.
6. Point to disabled Inbox/Settings, Privy’s disabled status, skipped live tests, and the first-linked-swap NO-GO.

## Exact local preview

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' corepack pnpm db:migrate
NODE_ENV=development \
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' \
ZECATHON_ENCRYPTION_KEY_FILE='/absolute/private/path/encryption-keyring.json' \
BASE_SEPOLIA_RPC_URL='https://YOUR_TRUSTED_BASE_SEPOLIA_RPC' \
PUBLIC_ORIGIN='http://localhost:8787' \
PRIVY_AUTH_ENABLED=0 \
corepack pnpm start
```

Open `http://localhost:8787`; documentation starts at `http://localhost:8787/docs/getting-started`.

## Release boundary and roadmap

The next safe milestones are: obtain an upstream-compatible Privy dependency resolution; complete real-tenant authentication acceptance; implement and verify the in-app outbox/inbox; then consider private contacts and handles without payment resolution. Email follows inbox acceptance. Mainnet requires a separate custody, liquidity, wallet, monitoring, and security milestone.

The immutable 07A image and first-linked-swap gate are unchanged. The gate remains **NO-GO**. This milestone stops at source review readiness.
