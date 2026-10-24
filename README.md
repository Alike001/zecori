# Zecathon Private Routes

An original, privacy-first application for one explicitly constrained cross-chain test route:

- Source: exactly `0.01 TAZ` (`1,000,000` zatoshis) on Zcash testnet, Ironwood shielded.
- Destination: exactly `1 test USDC` (`1,000,000` atomic units) on Base Sepolia (`84532`).
- Token: Circle test-USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Provider: trusted testnet liquidity provider with separate manual payout approval.
- Rate: fixed test rate, not a market quote.

The application does not offer mainnet execution, automatic payouts, trustless settlement, or automatic refunds. It never asks a browser user for a seed phrase or private key.

## Current implementation

The public application can inspect exact route terms, create an owner-scoped request, follow the durable operator/verification timeline, display encrypted-at-rest payment instructions only after a validated allocation, and retrieve a redacted or owner-private verified receipt.

The standalone Node server provides:

- `/api/v1` with strict API versioning and structured errors.
- HttpOnly session cookies, SameSite protection, exact-origin checks, and double-submit CSRF tokens.
- Request-size limits, rate limiting, HTTP parser timeouts, and security headers.
- `/health/live` and dependency-aware `/health/ready`.
- Static production assets and SPA fallbacks for `/history` and other frontend routes.
- No HTTP endpoints for address derivation, wallet RPC, payout approval, signing, or broadcasting.

PostgreSQL is authoritative for new production requests, signed order manifests, allocation journals, scoped authorizations, replay references, encrypted settlement evidence, authenticated receipts, state versions, ownership, and append-only audit history. Existing operator JSON databases are preserved but inactive and have deliberately not been migrated.

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
ZECATHON_ENCRYPTION_KEY_FILE='/absolute/private/path/encryption-keyring.json' \
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
ZECATHON_ENCRYPTION_KEY_FILE='/absolute/private/path/encryption-keyring.json' \
PUBLIC_ORIGIN='http://127.0.0.1:8787' \
ROUTE_DESTINATION_RECIPIENT='0xYOUR_CONFIRMED_BASE_SEPOLIA_RECEIVER' \
corepack pnpm start
node scripts/smoke-production.mjs http://127.0.0.1:8787
```

`NODE_ENV=production` expects a trusted TLS proxy and rejects API traffic without `X-Forwarded-Proto: https`.

## Deployment

See [production deployment](docs/production-deployment.md) for Docker Compose, TLS, secrets, health checks, backups, restore drills, and smoke tests. See [storage migration](docs/storage-migration.md) before moving private records and [production verifier architecture](docs/production-verifier.md) for the UFVK compatibility gate.

The Compose stack includes Caddy, the Node API, PostgreSQL, and an isolated read-only Base verification service. The verifier has no host port and requires a separate service token. Zcash verification deployment remains blocked pending an approved design that does not copy existing wallet secrets onto the server.

## Operator-only settlement commands

Private operator state defaults to `${XDG_DATA_HOME:-~/.local/share}/zecathon-crosschain-app` with mode-`0700` directories and mode-`0600` files. It is outside frontend assets and ignored by Git.

Production lifecycle commands require `DATABASE_URL`, `ZECATHON_ENCRYPTION_KEY_FILE`, and the separately provisioned operator HMAC key. Status and review are read-only:

```bash
corepack pnpm operator -- status
corepack pnpm operator -- pending-requests
corepack pnpm operator -- orders
```

The exact lifecycle sequence is:

```bash
corepack pnpm operator -- accept-request --request REQUEST_UUID --recipient EXACT_BASE_RECIPIENT --terms '0.01 TAZ -> 1 test USDC' --operator OPERATOR_ID --confirm 'EXECUTE ACCEPT-REQUEST'
corepack pnpm operator -- authorize-allocation --order ORDER_UUID --operator OPERATOR_ID --confirm 'EXECUTE AUTHORIZE-ALLOCATION'
corepack pnpm operator -- reserve-validated-allocation --order ORDER_UUID --authorization AUTH_UUID --receiver EXISTING_RECEIVER --operator OPERATOR_ID --confirm 'EXECUTE RESERVE-VALIDATED-ALLOCATION'
corepack pnpm operator -- publish-instructions --order ORDER_UUID --operator OPERATOR_ID --confirm 'EXECUTE PUBLISH-INSTRUCTIONS'
corepack pnpm operator -- observe-source --order ORDER_UUID --tx ZCASH_TXID --confirm 'EXECUTE OBSERVE-SOURCE'
corepack pnpm operator -- confirm-source --order ORDER_UUID --confirm 'EXECUTE CONFIRM-SOURCE'
corepack pnpm operator -- queue-payout --order ORDER_UUID --operator OPERATOR_ID --confirm 'EXECUTE QUEUE-PAYOUT'
corepack pnpm operator -- authorize-payout --order ORDER_UUID --operator OPERATOR_ID --confirm 'EXECUTE AUTHORIZE-PAYOUT'
corepack pnpm operator -- approve-payout --order ORDER_UUID --authorization AUTH_UUID --operator OPERATOR_ID --confirm 'EXECUTE APPROVE-PAYOUT'
corepack pnpm operator -- record-payout --order ORDER_UUID --tx BASE_TX_HASH --operator OPERATOR_ID --confirm 'EXECUTE RECORD-PAYOUT'
corepack pnpm operator -- verify-payout --order ORDER_UUID --confirm 'EXECUTE VERIFY-PAYOUT'
corepack pnpm operator -- verify-receipt --receipt RECEIPT_UUID
corepack pnpm operator -- expire-order --order ORDER_UUID --confirm 'EXECUTE EXPIRE-ORDER'
corepack pnpm operator -- mark-unresolved --order ORDER_UUID --reason REASON --operator OPERATOR_ID --confirm 'EXECUTE MARK-UNRESOLVED'
```

Every mutation requires its exact confirmation phrase in an interactive terminal. `reserve-validated-allocation` validates an already-existing receiver through isolated wallet RPC; it does not derive one. No command unlocks a wallet, signs or broadcasts a transaction, executes a payout, or moves funds. Operator mutations are absent from the public HTTP API.

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
