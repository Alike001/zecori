# Zecori

**Your Zcash. More possibilities.**

Zecori is an original, privacy-first application for one explicitly constrained cross-chain test route. The name is provisional; repository paths, package identifiers, environment-variable prefixes, and database names remain unchanged.

- Source: exactly `0.01 TAZ` (`1,000,000` zatoshis) on Zcash testnet, Ironwood shielded.
- Destination: exactly `1 test USDC` (`1,000,000` atomic units) on Base Sepolia (`84532`).
- Token: Circle test-USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Provider: trusted testnet liquidity provider with separate manual payout approval.
- Rate: fixed test rate, not a market quote.

The application does not offer mainnet execution, automatic payouts, trustless settlement, or automatic refunds. It never asks a browser user for a seed phrase or private key.

## Current implementation

The responsive public homepage explains the product, route availability, custody and recovery boundaries without requiring login. Visitors can explore every declared route; only the exact `0.01 TAZ -> 1 test USDC` test route is executable. Passkeys protect private history, tracking, and receipts. A financial request becomes operator-eligible only after an explicit EIP-712 or ERC-1271 destination-control proof; unverified destinations remain clearly labeled and blocked. Existing authenticated orders show genuine backend lifecycle state and reveal encrypted-at-rest payment instructions only after validated durable allocation.

Optional Google and email sign-in through Privy is feature-flagged and disabled by default. It verifies Privy access tokens on the server and maps their opaque subject to the existing internal UUID account model. It does not create embedded wallets, enable delegated actions, or change settlement ownership. Existing passkeys remain supported. See the [Milestone 08A review report](docs/milestone-08a-review-ready.md) for setup, acceptance steps, and current dependency-audit limitations.

The product now includes a navigable documentation site at `/docs/getting-started`, a shared feature-truth matrix, product navigation for Routes, Account, Activity, and the advisory AI assistant, plus clearly disabled Inbox and Settings locations. See the [Milestone 08B review report](docs/milestone-08b-review-ready.md), [handle/contact design](docs/handles-and-contacts-plan.md), [notification design](docs/notifications-plan.md), and [AI route contract](docs/ai-route-integration-contract.md).

Milestone 08C added deterministic multilingual route/review/status guidance, an authenticated opt-in Groq speech gateway with transcript correction and text fallback, `/docs/ai-and-voice`, an evidence-status roadmap, and an earlier Zecvia identity study retained as provenance. Milestone 08D provisionally adopts Zecori across the active product. See the [Milestone 08C review report](docs/milestone-08c-review-ready.md), [AI and voice boundaries](docs/ai-and-voice.md), [Zecori brand guidelines](docs/zecori-brand-guidelines.md), and [08D submission readiness](docs/milestone-08d-review-ready.md).

The standalone Node server provides:

- `/api/v1` with strict API versioning and structured errors.
- WebAuthn passkeys, stable database-backed users, rotating/revocable HttpOnly sessions, exact-origin checks, and double-submit CSRF tokens.
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
corepack pnpm test:browser
corepack pnpm privacy:scan
corepack pnpm security:gate
corepack pnpm preflight -- --static
```

Vite no longer contains backend middleware. For split development, run the API and Vite in separate terminals after configuring a disposable PostgreSQL database:

```bash
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' corepack pnpm db:migrate
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' \
ZECATHON_ENCRYPTION_KEY_FILE='/absolute/private/path/encryption-keyring.json' \
BASE_SEPOLIA_RPC_URL='https://YOUR_TRUSTED_BASE_SEPOLIA_RPC' \
PUBLIC_ORIGIN='http://127.0.0.1:5173' \
corepack pnpm dev:api
```

```bash
corepack pnpm dev
```

Each authenticated request supplies an explicitly confirmed Base Sepolia recipient. The server validates its EIP-55 form, encrypts it, and binds it to the owner and immutable manifest; there is no configured fallback recipient. Operator acceptance additionally requires the single-use EIP-712/ ERC-1271 destination-control ceremony documented in [Milestone 06C](docs/milestone-06c-destination-wallet-control.md).

## Local production mode

```bash
corepack pnpm build
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' corepack pnpm db:migrate
NODE_ENV=development \
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' \
ZECATHON_ENCRYPTION_KEY_FILE='/absolute/private/path/encryption-keyring.json' \
BASE_SEPOLIA_RPC_URL='https://YOUR_TRUSTED_BASE_SEPOLIA_RPC' \
PUBLIC_ORIGIN='http://127.0.0.1:8787' \
corepack pnpm start
node scripts/smoke-production.mjs http://127.0.0.1:8787
```

`NODE_ENV=production` expects a trusted TLS proxy and rejects API traffic without `X-Forwarded-Proto: https`.

## Deployment

See [production deployment](docs/production-deployment.md) for Docker Compose, TLS, secrets, health checks, backups, restore drills, and smoke tests. See [storage migration](docs/storage-migration.md) before moving private records and [production verifier architecture](docs/production-verifier.md) for the UFVK compatibility gate.

For isolated localhost staging, passkey behavior, encrypted backup/restore, and the exact safe startup commands, see [milestone 05 staging](docs/staging-milestone-05.md).

The Compose stack includes Caddy, the Node API, PostgreSQL, and an isolated read-only Base verification service. The verifier has no host port and requires a separate service token. Zcash source verification uses a durable PostgreSQL relay with separate Ed25519 coordinator/verifier identities, short-lived signed messages, encrypted evidence and lease recovery; wallet RPC remains loopback-only on the operator host. Production use still requires approved PostgreSQL mTLS identities and a separately approved watch-only UFVK ceremony.

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
corepack pnpm operator -- accept-request --request REQUEST_UUID --terms '0.01 TAZ -> 1 test USDC' --operator OPERATOR_ID --confirm 'EXECUTE ACCEPT-REQUEST'
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

The assistant now runs through a provider-independent server gateway. Its only model-callable functions are the typed, allow-listed public and account-scoped tools in `server/agent-tools.ts`. Account tools resolve ownership again on the server and send only redacted status or shareable receipt data to the model. No tool can derive an address, create an order, approve a payout, sign, broadcast, or call operator controls.

Without provider configuration, `/api/v1/capabilities` and every assistant response clearly report `limited` mode. Limited mode remains deterministic and does not present itself as generative AI. The gateway supports explicit OpenAI and Groq Responses adapters; the reviewed Groq model is `openai/gpt-oss-20b`. Credentials alone do not activate either provider: external calls require the exact separate `AI_EXTERNAL_REQUESTS_APPROVED` operator opt-in. See [AI agent operations](docs/ai-agent-operations.md) for dedicated-project key handling, budgets, provider-specific retention behavior, bounded request settings, and separately gated live validators.

Voice remains disabled in the product UI because no speech provider has been configured and tested. The voice state machine requires a user-initiated processing and retention disclosure before microphone permission, exposes recording/processing/transcript-confirmation states, blocks wallet/session material from speech output, and marks every transcript as incapable of payment authorization. Text input remains available.

English, French, and Arabic message catalogs and locale negotiation are available, including right-to-left layout for Arabic. English is reviewed; French and Arabic are explicitly marked machine-generated and unvalidated. New locales fail closed to English at the UI boundary and are rejected by the agent API unless registered.

Milestone 06A's public swap journey and the exact destination-binding blocker are documented in [wallet readiness](docs/milestone-06a-wallet-readiness.md).

## Non-negotiable safety rules

- No wallet unlocking through the application.
- No automatic address derivation.
- No transaction signing or broadcasting.
- No automatic payout approval or retry.
- No mainnet execution.
- No client-provided evidence can mark an order completed.
- No operator HMAC key may be reused as a wallet or database-encryption key.
- No existing wallet, cookie, key, or private order database may be copied into a deployment image.
