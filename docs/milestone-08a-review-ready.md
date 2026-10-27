# Milestone 08A — Review ready

Status: `08A_REVIEW_READY`

Reviewed source: clean `main` commit `d90abbd3d8ec5a542516305e0576ff3427e1b622` (the immutable 07A candidate). Work is isolated on `feat/milestone-08a-consumer-privy`. No 07B-named acceptance report existed in the reviewed repository; the available 06D integrated review and 07A release-candidate evidence were used instead.

## Delivered surface

- A responsive public homepage with an immediate product explanation, route exploration, how-it-works, custody/privacy and recovery disclosures, FAQ, keyboard skip link, and mobile navigation.
- A human-readable journey from route selection through sign-in, wallet configuration, review, destination proof, request, tracking, and receipt.
- One shared typed capability registry used by the browser, public API, and assistant route tool. Every entry is `verified-executable`, `experimental-disabled`, or `research-only`.
- The sole executable route remains exactly `0.01 TAZ` on Zcash testnet to `1 test USDC` on Base Sepolia. No quote, balance, wallet support, successful payment, or route availability is fabricated.
- Feature-flagged Privy email/Google authentication using the current React and Node SDKs. Embedded wallet creation is off for Ethereum and Solana, wallet UI is off, and there are no delegated actions or server-controlled signing APIs.
- Server-side access-token verification and a database-backed Privy-subject-to-existing-UUID mapping. Raw Privy subjects and email addresses are not stored. Account linking requires an existing authenticated session, a valid CSRF token, and an explicit second user action. Conflicting subjects and cross-user links fail closed.
- Existing passkey registration/login/recovery, rotating sessions, CSRF/origin enforcement, private history, encrypted destinations, destination ownership proofs, immutable manifests, audit history, and independent settlement verification remain in place.

## Privy manual setup

Privy remains disabled when credentials are absent. To exercise it in an approved local environment:

1. Create or select a Privy app and enable only email and Google login. Add the exact local origin to the app's allowed origins.
2. Obtain the app ID and access-token verification public key. Store the verification key in a mode-`0600` file outside this repository. Do not provide an app secret, wallet key, signing key, or delegated-action credential to this application.
3. Start the API with:

   ```bash
   PRIVY_AUTH_ENABLED=1 \
   PRIVY_APP_ID='your-dashboard-app-id' \
   PRIVY_VERIFICATION_KEY_FILE='/absolute/private/path/privy-verification-key.pem' \
   DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' \
   ZECATHON_ENCRYPTION_KEY_FILE='/absolute/private/path/encryption-keyring.json' \
   BASE_SEPOLIA_RPC_URL='https://YOUR_TRUSTED_BASE_SEPOLIA_RPC' \
   PUBLIC_ORIGIN='http://127.0.0.1:5173' \
   corepack pnpm dev:api
   ```

4. Run `corepack pnpm dev` in a second terminal and open `http://127.0.0.1:5173`.

Only the public app ID reaches the browser. The verification key stays server-side. When the flag is `0` or unset, the client does not load the Privy provider bundle and passkeys continue to work normally.

## Human acceptance

Use disposable PostgreSQL data and synthetic test identities only.

1. Open `/` signed out at desktop and mobile widths. Confirm the product purpose, exact usable route, experimental labels, privacy/custody disclosures, safety/recovery text, FAQ, focus-visible navigation, and skip link are understandable without technical guidance.
2. Select the executable route and confirm `/swap` permits exploration before login but requires authentication before a private request can be created.
3. Confirm experimental and research-only route cards cannot begin a financial flow and do not show invented prices, balances, providers, or success states.
4. Register two passkeys, sign out, sign in with either passkey, revoke one credential, and confirm the remaining credential still recovers the same private history.
5. With approved Privy configuration, sign in once with email and once with Google. Confirm no embedded wallet is created. Sign out and back in and verify that the same Privy subject returns to the same internal account.
6. While authenticated with a passkey, explicitly connect and then link a Privy identity. Verify the link needs CSRF and a second confirmation action. Attempt to link the same identity to a different account and a second Privy identity to the first account; both must fail without merging history.
7. Enter an invalid or wrong-network destination and confirm it is rejected. Prove control of the correct Base Sepolia destination and confirm the proof is owner-scoped.
8. Create only an unfunded synthetic request. Confirm payment instructions remain hidden before durable allocation and all approvals, lifecycle labels match backend state, another account cannot read it, and no UI action can approve, sign, broadcast, or record a payout.

## Verification evidence

Completed on 2026-10-26:

- Disposable PostgreSQL 17 migrations `001`–`009`: passed.
- Unit and integration suite: 161 tests; 159 passed, 0 failed, 2 intentionally skipped live-network experiments.
- Typecheck: passed.
- Production build: passed. Vite reports the optional dynamically loaded Privy chunk above its 500 kB advisory threshold; the disabled/default path does not load that chunk.
- Guest/mobile/wallet-safety browser smoke: passed (`MILESTONE_06D_BROWSER_SMOKE_PASSED`).
- WebAuthn/passkey browser smoke: passed (`PASSKEY_BROWSER_SMOKE_PASSED`) on isolated port `18789`, including two credentials, revocation, re-login, private history, and unverified-destination blocking.
- Privacy scan: passed.
- Read-only security gate: passed.
- Staging static gate: all 27 checks passed (`DURABLE_STAGING_STATIC_READY`). Durable staging was not accessed or migrated.
- Production static preflight: all 13 substantive checks passed; the overall command intentionally returned review-blocked because the branch is not `main` and has an uncommitted review diff.
- `git diff --check`: passed.

Live Privy browser acceptance is blocked because no Privy app ID or verification key was supplied. Token verification, account mapping, explicit linking, conflict rejection, and ownership isolation were covered with injected-verifier API/database integration tests.

`pnpm audit --prod --audit-level high` is blocked by two high-severity instances of the Zod memory-exhaustion advisory `GHSA-mrhx-c7xc-m3w5`, pulled transitively through the latest installed `@privy-io/react-auth` wallet-connector graph. A separate vulnerable `ws` range was safely remediated with a same-major override to `8.21.0`. Zod was not force-overridden across a major version because that would create unreviewed SDK incompatibility. Privy therefore remains opt-in and disabled by default pending an upstream-compatible dependency resolution and a fresh audit.

## Changed files

- Product surface: `index.html`, `public/favicon.svg`, `src/App.tsx`, `src/main.tsx`, `src/styles.css`.
- Shared capabilities and client API: `src/lib/route-capabilities.ts`, `src/lib/route-capabilities.test.ts`, `src/lib/order-api.ts`, `server/route-registry.ts`.
- Privy boundary: `.env.example`, `package.json`, `pnpm-lock.yaml`, `src/lib/privy-bridge.tsx`, `src/lib/privy-enabled.tsx`, `server/privy-auth.ts`, `server/public-api.ts`, `server/app-server.ts`, `server/user-auth.ts`, `server/migrations/009_privy_identity.sql`.
- Acceptance and recovery coverage: `scripts/milestone-06a-browser-smoke.mjs`, `scripts/passkey-browser-smoke.mjs`, `scripts/staging-preflight.mjs`, `scripts/verify-backup-source.ts`, `scripts/verify-restored-db.ts`, `server/app-server.test.ts`, `server/user-auth.integration.test.ts`.
- Handoff: `README.md`, `docs/milestone-08a-review-ready.md`.

## Exact local preview

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' corepack pnpm db:migrate
NODE_ENV=development \
DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/zecathon' \
ZECATHON_ENCRYPTION_KEY_FILE='/absolute/private/path/encryption-keyring.json' \
BASE_SEPOLIA_RPC_URL='https://YOUR_TRUSTED_BASE_SEPOLIA_RPC' \
PUBLIC_ORIGIN='http://127.0.0.1:8787' \
corepack pnpm start
```

Open `http://127.0.0.1:8787`. Privy is off in this command; add only the three reviewed variables from the setup section to test it.

## Release boundary

No deployment, push, real wallet secret, transaction signature, broadcast, address derivation, funded order, payout, or durable-staging mutation was performed. The first-linked-swap gate remains **NO-GO** until its existing independent operational approvals and evidence are complete. This milestone stops at source review readiness, not release authorization.
