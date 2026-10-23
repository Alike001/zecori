# Zecathon Private Routes

An original, privacy-first application for one explicitly constrained cross-chain test route:

- Source: exactly `0.01 TAZ` (`1,000,000` zatoshis) on Zcash testnet, Ironwood shielded.
- Destination: exactly `1 test USDC` (`1,000,000` atomic units) on Base Sepolia (`84532`).
- Token: Circle test-USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Provider: trusted testnet liquidity provider with separate manual payout approval.
- Rate: fixed test rate, not a market quote.

The application does not offer mainnet execution, automatic payouts, trustless settlement, or automatic refunds. It never asks a browser user for a seed phrase or private key.

## Current implementation

The public application can inspect exact route terms, create an owner-scoped request, wait for operator review, display payment instructions only after a future durable operator allocation, show private-session request history, and explain the route through a constrained assistant.

The standalone Node server provides:

- `/api/v1` with strict API versioning and structured errors.
- HttpOnly session cookies, SameSite protection, exact-origin checks, and double-submit CSRF tokens.
- Request-size limits, rate limiting, HTTP parser timeouts, and security headers.
- `/health/live` and dependency-aware `/health/ready`.
- Static production assets and SPA fallbacks for `/history` and other frontend routes.
- No HTTP endpoints for address derivation, wallet RPC, payout approval, signing, or broadcasting.

PostgreSQL migrations define immutable order manifests, allocation journals, authorization records, replay-safe settlement evidence, verified receipts, state versions, public request ownership, and append-only audit history. The existing operator JSON database has deliberately not been migrated.

## Development

Requirements: Node `24.14.1`, pnpm `10.33.4`, and PostgreSQL 17 for production-mode tests.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm privacy:scan
corepack pnpm security:gate
```

Vite no longer contains backend middleware. For split development, run the API and Vite in separate terminals after configuring a disposable PostgreSQL database:

```bash
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' corepack pnpm db:migrate
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' \
PUBLIC_ORIGIN='http://127.0.0.1:5173' \
ROUTE_DESTINATION_RECIPIENT='0xYOUR_CONFIRMED_BASE_SEPOLIA_RECEIVER' \
corepack pnpm dev:api
```

```bash
corepack pnpm dev
```

Use the complete operator-confirmed public Base Sepolia recipient. The server rejects incomplete and zero addresses.

## Local production mode

```bash
corepack pnpm build
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' corepack pnpm db:migrate
NODE_ENV=development \
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' \
PUBLIC_ORIGIN='http://127.0.0.1:8787' \
ROUTE_DESTINATION_RECIPIENT='0xYOUR_CONFIRMED_BASE_SEPOLIA_RECEIVER' \
corepack pnpm start
node scripts/smoke-production.mjs http://127.0.0.1:8787
```

`NODE_ENV=production` expects a trusted TLS proxy and rejects API traffic without `X-Forwarded-Proto: https`.

## Deployment

See [production deployment](docs/production-deployment.md) for Docker Compose, TLS, secrets, health checks, backups, restore drills, and smoke tests. See [storage migration](docs/storage-migration.md) before any attempt to move private operator records.

The Compose stack includes Caddy, the Node API, PostgreSQL, and an isolated read-only Base verification service. The verifier has no host port and requires a separate service token. Zcash verification deployment remains blocked pending an approved design that does not copy existing wallet secrets onto the server.

## Operator-only configuration

Private operator state defaults to `${XDG_DATA_HOME:-~/.local/share}/zecathon-crosschain-app` with mode-`0700` directories and mode-`0600` files. It is outside frontend assets and ignored by Git.

Status is read-only:

```bash
corepack pnpm operator -- status
corepack pnpm operator -- readiness
corepack pnpm operator -- preflight
```

Wallet A must be bound explicitly; there is no guessed path, Wallet B fallback, or mainnet fallback:

```bash
corepack pnpm operator -- configure-source-wallet \
  --rpc 'http://127.0.0.1:18392/' \
  --data-dir '/absolute/path/to/existing/zecd-testnet-data' \
  --confirm 'CONFIGURE EXISTING TESTNET WALLET A'
```

This stores no wallet cookie or key. It refuses symlinks, weak permissions, Wallet B, non-loopback RPC, and overwrite attempts.

Address allocation, activation, payout approval, and payout-reference recording remain authenticated operator CLI actions. They are intentionally absent from the public API. Do not run them without a separate reviewed authorization boundary.

## Assistant and voice boundaries

The current assistant uses a typed capability registry and deterministic intent router. No third-party generative model is enabled. It may explain privacy, route terms, custody, refunds, and owner-authorized request status. Injection attempts, secret requests, payout approval, signing, and unsupported transfers are refused.

Voice is disabled. The adapter contract requires explicit microphone permission and a provider-specific privacy and retention disclosure before activation. Spoken words can never authorize a payment or payout.

Only English is enabled because it is the only reviewed language in this milestone.

## Non-negotiable safety rules

- No wallet unlocking through the application.
- No automatic address derivation.
- No transaction signing or broadcasting.
- No automatic payout approval or retry.
- No mainnet execution.
- No client-provided evidence can mark an order completed.
- No operator HMAC key may be reused as a wallet or database-encryption key.
- No existing wallet, cookie, key, or private order database may be copied into a deployment image.
