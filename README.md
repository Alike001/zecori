# Zecori

**Private origin. Verified arrival.**

Zecori is a privacy-first prototype for moving value from a shielded Zcash source to another chain without pretending that the whole journey is private or trustless. It explores one deliberately constrained testnet route: a shielded Zcash payment followed by an operator-approved test-USDC payout on Base Sepolia.

The product is designed to make privacy boundaries, custody, readiness, and settlement evidence visible. It never asks a browser user for a seed phrase or private key, and the public application cannot unlock a wallet, sign or broadcast a transaction, approve a payout, or declare settlement complete.

![Zecori home screen](docs/screenshots/zecori-home-dark.png)

## Current status

This README describes the final privacy-first consumer UX candidate prepared on 2026-10-27.

| Area | Verified state |
| --- | --- |
| Product and route lifecycle | Implemented and locally tested; public route remains closed |
| Route request creation | Disabled by default; requires current operator, liquidity, and fixed-term attestations |
| Linked funded Zcash-to-Base settlement | **Not performed or verified** |
| Public deployment | **Live and HTTPS-verified at [zecori.iamalikex.tech](https://zecori.iamalikex.tech)** |
| Public data/auth | Ten Neon migrations applied; liveness, readiness, guarded smoke, passkey sign-in, and one handle claim verified |
| Mainnet or additional chains | **Not supported** |
| Demo and video | Working demo verified; no final video URL is recorded yet |

The only implemented financial route is:

- **Source:** exactly `0.01 TAZ` (`1,000,000` zatoshis) from the Zcash testnet Ironwood shielded pool.
- **Destination:** exactly `1 test USDC` (`1,000,000` atomic units) on Base Sepolia, chain ID `84532`.
- **Token contract:** Circle test-USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- **Terms:** a fixed integration-test outcome, not a market quote or liquidity promise.
- **Provider model:** an experimental trusted testnet liquidity provider with temporary custody and separate manual payout approval.

Do not send funds based on repository text, the public demo, or the nonfinancial walkthrough. Payment instructions are designed to appear only after an authenticated request, destination proof, operator acceptance, and validated receiver allocation.

## How the guarded workflow works

1. A visitor opens the app and immediately sees current availability, exact fixed test terms, privacy boundaries, and custody limits without signing in.
2. While requests are closed, Zecori shows a nonfinancial walkthrough and no wallet, recipient, or payment form. If a future approved deployment reports the route open, wallet setup and review appear progressively.
3. The user signs in with a passkey only when an owner-scoped request is appropriate and explicitly confirms a Base Sepolia recipient.
4. A purpose-limited EIP-712 signature proves control of the destination address. It cannot spend tokens or authorize a payout. ERC-1271 support exists behind a disabled flag and has not passed live contract-wallet validation.
5. The backend creates an owner-scoped request with immutable terms. Request creation fails closed unless the deployment has current operator, liquidity, and term-expiry attestations.
6. An operator separately accepts the request and allocates a dedicated shielded receiver through guarded, audited controls. Only then can payment instructions be published.
7. Read-only verification checks the exact incoming Ironwood output and its confirmations. A separate operator approval is required before an external signer can submit the Base Sepolia payout.
8. The backend verifies the canonical test-USDC transfer against the immutable recipient, amount, token contract, and approved sender before producing a private receipt.

The code and fixture-backed tests cover this lifecycle. Settlement infrastructure, live chain integrations, operator liquidity, the external payout signer, and the first newly linked funded settlement remain unverified.

## Privacy and trust model

Zecori starts from a shielded source instead of requiring the user to unshield before entering the route. Private destinations, payment instructions, settlement evidence, and owner receipts are encrypted at rest. Shareable receipts omit transaction IDs, addresses, internal order correlation, exact settlement amounts, and settlement timestamps.

Privacy is not end to end:

- the Base Sepolia destination and token transfer are public;
- the receiving operator can correlate the private request, dedicated Zcash receiver, source evidence, and public payout;
- amount and timing may enable outside correlation;
- a shielded memo is visible to the receiving operator, so instructions require no memo; and
- settlement depends on an operator and liquidity provider, not an atomic bridge or trustless protocol.

There are no automatic payouts or refunds. Ambiguous evidence, reorgs, replay attempts, mismatched recipients, stale authorizations, or interrupted broadcasts must stop in an unresolved state for human review. See [settlement privacy and chain evidence](docs/settlement-privacy-evidence.md) for the detailed observer and data-boundary analysis.

## Implemented and locally tested

- Responsive route exploration, review, recovery, private activity, and receipt experiences, including mobile, reduced-motion, dark/light, and Arabic right-to-left layouts.
- Passkey registration and login, multiple credentials, rotating and revocable HttpOnly sessions, exact-origin checks, double-submit CSRF protection, and owner isolation.
- A versioned `/api/v1` Node server with structured errors, request limits, rate limiting, security headers, parser timeouts, and liveness/readiness endpoints.
- PostgreSQL-backed immutable manifests, allocation journals, scoped authorizations, replay protection, encrypted private data, lifecycle recovery states, receipts, and append-only audit history.
- EIP-712 destination-control proof, EIP-55 recipient validation, owner binding, and rejection of unverified destinations.
- Guarded operator lifecycle controls, read-only Zcash source checks, signed private-verifier relay contracts, Base Sepolia transfer verification, and duplicate-settlement protection.
- Optional handles, exact-match opt-in discovery, encrypted contacts, non-paying request intents, and a durable owner-scoped inbox backed by a transactional outbox. Handles never resolve to wallet addresses or authorize payment.
- A deterministic limited-mode assistant with typed, allow-listed tools and no wallet or settlement authority.
- Build-time MDX product documentation and English, French, and Arabic message catalogs. French and Arabic security wording still awaits human review.

Local evidence includes unit, API, PostgreSQL integration, virtual WebAuthn/browser, accessibility, privacy, security, documentation, type-check, and production-build checks. Two live-chain tests are intentionally skipped in the recorded suite. See the [submission release review](docs/submission-release-review.md) and [roadmap](ROADMAP.md) for the evidence ledger and remaining gates.

## Implemented but not live-verified

- The full shielded-source to Base Sepolia lifecycle for a newly linked order.
- Final-host EIP-712 wallet behavior and optional ERC-1271 contract-wallet checks.
- The signed private Zcash verifier relay against a persistent synchronized testnet backend.
- Two-profile isolation and linked account flows on the public deployment. A real final-domain passkey sign-in and handle claim are verified, but broader live acceptance remains pending.
- Provider-backed AI and Groq speech. Both require explicit operator opt-in, credentials, and live acceptance; voice remains disabled in the product UI.
- Noir Wallet v1.0.40 compatibility. The read-only adapter fails closed pending an isolated, checksum-verified testnet extension test.
- Privy email and Google sign-in. The client path is compiled out and disabled pending a clean supported dependency graph and live tenant acceptance.

Mainnet, live quotes, automatic settlement, automatic refunds, payment by handle, external notifications, and active multichain support are not implemented product capabilities.

## Architecture

```text
React + Vite web application
  ├─ public route and capability registry
  ├─ passkey-protected account, activity, inbox, and receipts
  ├─ build-time MDX documentation
  └─ deterministic / optional provider-backed assistant
                  │
                  │ same-origin /api/v1, CSRF and owner checks
                  ▼
Standalone Node server ───────── PostgreSQL authority
  ├─ auth and rotating sessions   ├─ immutable order manifests
  ├─ route-readiness gates        ├─ encrypted private records
  ├─ lifecycle and recovery       ├─ transactional outbox
  └─ health/static SPA serving    └─ append-only audit history
                  │
                  │ signed evidence and explicit operator actions
                  ▼
Private operator boundary (not exposed by the public HTTP API)
  ├─ Zcash testnet read-only verification / receiver allocation
  ├─ manual liquidity and payout approval
  ├─ external Base payout signer (not included in this repository)
  └─ Base Sepolia canonical transfer verification
```

The standalone server serves both the production frontend and API. Vite is a frontend-only development server. The public API has no endpoints for wallet RPC, address derivation, payout approval, signing, or broadcasting.

## Run and test locally

Requirements:

- Node.js `24.14.1`
- pnpm `10.33.4` through Corepack
- PostgreSQL 17 for production-mode and integration testing

Install and run the local verification suite:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm docs:validate
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:browser
corepack pnpm privacy:scan
corepack pnpm security:gate
corepack pnpm preflight -- --static
```

For split development, configure a disposable PostgreSQL database, then run the API and Vite in separate terminals:

```bash
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' \
corepack pnpm db:migrate

DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' \
ZECATHON_ENCRYPTION_KEY_FILE='/absolute/private/path/encryption-keyring.json' \
BASE_SEPOLIA_RPC_URL='https://YOUR_TRUSTED_BASE_SEPOLIA_RPC' \
PUBLIC_ORIGIN='http://127.0.0.1:5173' \
corepack pnpm dev:api
```

```bash
corepack pnpm dev
```

Open `http://127.0.0.1:5173`. Financial readiness flags are off by default; keep them off for UI and account testing.

To exercise the built application through the standalone server:

```bash
corepack pnpm build
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' \
corepack pnpm db:migrate

NODE_ENV=development \
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' \
ZECATHON_ENCRYPTION_KEY_FILE='/absolute/private/path/encryption-keyring.json' \
BASE_SEPOLIA_RPC_URL='https://YOUR_TRUSTED_BASE_SEPOLIA_RPC' \
PUBLIC_ORIGIN='http://127.0.0.1:8787' \
corepack pnpm start

node scripts/smoke-production.mjs http://127.0.0.1:8787
```

`NODE_ENV=production` requires a trusted TLS proxy and rejects API traffic unless the forwarded protocol is HTTPS. Use disposable data and synthetic identities for all local acceptance work.

## Deployment

The judge web application is live at [https://zecori.iamalikex.tech](https://zecori.iamalikex.tech). HTTPS, `/health/live`, `/health/ready`, the ten Neon migrations, and the guarded judge smoke have been verified. The Render startup contract keeps route requests and liquidity disabled.

### Judge deployment: Render + Neon

The [free Render and Neon runbook](docs/free-render-neon-deployment.md) describes the live one-process Node web service backed by TLS-only Neon PostgreSQL. It keeps all financial readiness flags disabled. Do not interpret the verified web deployment as settlement readiness.

This public web deployment alone cannot settle a route. A persistent private verifier host, synchronized Zcash testnet backend, separately authorized watch-only setup, operator liquidity, external Base signer, backup/restore evidence, and manual operating procedure are still required. See [private verifier hosting](docs/private-verifier-hosting.md).

### Dedicated deployment: Docker Compose

The [production deployment guide](docs/production-deployment.md) covers the Caddy, Node, PostgreSQL, and isolated verifier topology, including TLS, secrets, exact Git revision provenance, health checks, backups, restore drills, and smoke tests. [Judge deployment](docs/judge-deployment.md) documents the isolated Compose alternative.

Set `VCS_REF` to the exact reviewed 40-character revision before building. Never copy an existing wallet, cookie, key, database, or private order record into an image. Deployment, DNS, migrations, provider activation, wallet access, and settlement each require separate operator authorization.

## Documentation

- [Roadmap and evidence status](ROADMAP.md) — implemented, locally tested, awaiting live verification, blocked, and future work.
- [Getting started](src/docs/pages/getting-started.mdx) and [route availability](src/docs/pages/route-availability.mdx) — the user-facing product guide.
- [Privacy and custody](src/docs/pages/privacy-custody.mdx) and [security](src/docs/pages/security.mdx) — user-visible guarantees and limits.
- [Order recovery](src/docs/pages/order-recovery.mdx) and [receipts](src/docs/pages/receipts.mdx) — lifecycle and evidence semantics.
- [API architecture](src/docs/pages/api-architecture.mdx) — application boundaries and service responsibilities.
- [First linked test readiness](docs/first-linked-test-readiness.md) — future approval sequence; it is not authorization to transact.
- [Production verifier](docs/production-verifier.md) and [storage migration](docs/storage-migration.md) — infrastructure and private-data handling.
- [AI and voice boundaries](docs/ai-and-voice.md) and [AI agent operations](docs/ai-agent-operations.md) — provider gates and no-authority guarantees.
- [Two-minute walkthrough](docs/zecathon-two-minute-walkthrough.md) and [Zecathon submission packet](docs/zecathon-submission.md) — judge-ready language using verified claims only.

The built application also exposes the local manual at `/docs/getting-started`.

## For contributors and judges

Start at the [live application](https://zecori.iamalikex.tech), choose **Open app**, inspect the closed route state, expand **Explore how it works**, open Help, then use a disposable passkey account for Account, Activity, and the notification bell. Treat fixture-backed receipts and UI previews as demonstrations of state handling, not proof of a funded settlement. The [roadmap](ROADMAP.md) is the source of truth for evidence status.

Contributions should preserve the fail-closed capability registry, owner isolation, operator separation, and explicit status language. New chains or tokens are not supported until their recipient proof, verifier, liquidity, signer separation, recovery behavior, and receipt evidence independently pass the same gates.

## Non-negotiable safety rules

- No wallet unlocking through the public application.
- No automatic address derivation, transaction signing, or broadcasting.
- No automatic payout approval, retry, or refund promise.
- No mainnet execution.
- No client-provided evidence can mark an order completed.
- No operator HMAC key may be reused as a wallet or database-encryption key.
- No private wallet, cookie, key, or order database may be copied into a deployment image.
