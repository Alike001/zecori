# Milestone 06A — swap UX and wallet readiness

Status: **guest exploration and read-only wallet readiness implemented; new order creation intentionally blocked**.

No wallet was unlocked. No address was derived or allocated. No transaction was signed or broadcast. No payout, deployment, funded order, production secret, PostgreSQL record, wallet database, container, or Docker volume was changed.

## What is available

- Guests can inspect the single supported route and use the route assistant without authentication.
- The route is labeled as fixed test terms, not a live quote.
- The responsive journey covers route, amount, wallet readiness, terms, request, payment, tracking, and receipt stages.
- Zcash has two source-wallet modes: a capability-checked `zecathon-zcash-readonly-v1` browser adapter, or an explicitly manual external-wallet path. The adapter must prove Zcash testnet, Ironwood, and a read-only contract. No signing method is defined or called.
- Base wallet inspection uses only EIP-1193 `eth_chainId` and `eth_accounts`. It never calls account-permission, chain-switch, signing, or transaction methods. Base Sepolia chain `84532` is mandatory.
- Manual Base recipients are validated locally as complete, non-zero EVM addresses.
- Passkeys remain mandatory for private request creation, private order history, tracking, and private receipts. Public route browsing and public route explanations remain guest-accessible.
- Existing authenticated orders continue to display backend statuses, durable timeline events, payment instructions when present, and owner-private receipts when the backend reports completion.

## Why new requests fail closed

Milestone 06B removes the `ROUTE_DESTINATION_RECIPIENT` runtime dependency. New requests use an encrypted owner-scoped destination intent; a connected account or passkey session still does not prove wallet control.

`POST /api/v1/order-requests` now enforces authentication, CSRF, exact route terms, Zcash testnet/Ironwood source policy, Base Sepolia chain identity, and recipient format. Even a valid intent returns HTTP `409` with `DESTINATION_BINDING_UNAVAILABLE`. No request row is created.

The following backend work is required before that gate may be enabled:

1. Add a reviewed migration for an immutable owner-scoped destination-wallet binding. Store the normalized chain ID and recipient against the stable user ID, not a browser-supplied session label.
2. Add an explicit ownership/consent ceremony for the Base recipient. Address format and an injected account alone do not prove durable ownership. Define replay-resistant evidence, expiry, revocation, and re-binding rules.
3. Bind the verified destination record into the public request, operator order manifest, manifest signature, and acceptance transaction. The operator must not substitute the configured receiver.
4. Extend acceptance and audit records with destination-binding ID/fingerprint and append-only events. Reject mismatches and post-acceptance changes.
5. Encrypt any private binding metadata at rest, expose only the minimum owner-private projection, and keep the public capability document receiver-free.
6. Add PostgreSQL integration tests for cross-account isolation, concurrent binding, replay, revocation, operator mismatch, restart recovery, backup/restore continuity, and migration rollback behavior.
7. Re-run staging recovery evidence and operator review before changing `orderCreation.enabled` or allowing any unfunded request.

The existing fixed receiver may remain an internal operator/staging configuration input until that migration, but it must never be described as the user's personal receiving wallet.

## Payment-address publication invariant

The UI only renders a Zcash payment receiver when the authenticated order response contains `paymentInstructions`. The existing settlement store produces that field only after operator acceptance and a validated durable allocation reaches `PAYMENT_READY`. Before then, the interface states that no payment address is published and instructs the user not to pay.

## Verification

Run from the repository root:

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:browser
corepack pnpm privacy:scan
corepack pnpm security:gate
corepack pnpm staging:gate
corepack pnpm preflight -- --static
```

The browser test launches an isolated headless Chrome profile against an in-memory guest server. It verifies public route exploration, the passkey boundary, responsive mobile width, Zcash capability checks, Base network rejection, invalid recipient handling, the disabled premature request action, and non-disclosure of the configured operator receiver.
