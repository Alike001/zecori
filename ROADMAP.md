# Zecori roadmap and evidence status

Updated: 2026-10-28. **Implemented** means code exists, **locally tested** means automated or isolated local evidence passed, and **live verified** means the final hosted or chain environment was exercised. Anything awaiting live verification or blocked must not be advertised as available. See the [final sprint matrix](docs/final-submission-sprint.md).

## Working and verified now

- Public Render deployment at [https://zecori.iamalikex.tech](https://zecori.iamalikex.tech), HTTPS, `/health/live`, `/health/ready`, ten Neon migrations, and guarded judge smoke. Route and liquidity flags remain disabled.
- Availability-first public route explorer, nonfinancial closed-state walkthrough, contextual Help, documentation, mobile layouts, dark/light themes, reduced motion, and English/French/Arabic RTL rendering. French and Arabic security copy remains labelled as awaiting human review.
- Passkey registration and login, multiple credentials, session rotation/revocation, owner-scoped history and receipts. One real final-domain passkey sign-in and handle claim are verified.
- Optional handles, exact-match opt-in discovery, encrypted contacts, non-paying request intents, and the durable owner-scoped inbox.
- The fixed Zcash testnet Ironwood to Base Sepolia test-USDC lifecycle: exact terms, destination-control authorization, fresh receiver allocation, strict source verification, separate payout approval, destination verification, recovery states, and duplicate-settlement protection. All financial gates remain disabled by default.
- Deterministic guided Help backed by reviewed route facts. It has no order, wallet, signing, payout, or broadcast authority; unavailable voice controls are hidden.
- Final local regression evidence: 217-test suite with 204 passes and 13 explicit live/integration skips, separate fresh-PostgreSQL 11/11 pass, browser/mobile/accessibility pass, WCAG contrast pass, privacy/security pass, 17-page docs validation, production build, clean production dependency audit, and live closed-route smoke.

## Implemented but not yet accepted live

- Two-profile isolation, contacts/request exchange, inbox isolation, rename behavior, and mobile-browser acceptance against the public deployment. These must use disposable data and must not mutate the current public database without operator approval.
- EIP-712 EOA and ERC-1271 destination-control checks against final hosted RPC configuration.
- Zcash shielded-source verification through the signed private relay and Base Sepolia destination verification for a newly authorized linked order.
- Provider-backed AI, microphone transcription, and speech output. These remain feature-gated and must not be described as live integrations.
- Noir Wallet testnet SDK/provider compatibility. The product option is disabled until an isolated testnet build can attest network and Ironwood requirements without secrets, transparent intermediate transfers, automatic spend, or unreviewed transaction methods.
- Variable amounts. A default-off isolated engine now tests integer atomic math, approved test rates, fees, min/max, capacity reservation, expiry, exact binding, rounding, and no double allocation. It is not connected to the route, API, UI, or deployment.

## Blocked by external infrastructure or authorization

- An executable Zcash-to-Base route requires a persistent private verifier host, a synchronized Zcash testnet backend, separately authorized watch-only UFVK setup, and end-to-end private relay monitoring.
- Settlement additionally requires confirmed test-USDC and gas liquidity, an independently controlled Base payout signer, a manual approval/broadcast procedure, and explicit authorization for every wallet or financial action.
- Backup, restore, monitoring, and an operator recovery procedure must be proven before a live request can publish payment instructions.
- French and Arabic security language needs human review. Privy and paid-provider AI/voice remain disabled unless their separate security and live acceptance gates clear.
- Final submission still needs a human-recorded/uploaded two-minute video and an authenticated form receipt. The first linked source transaction, Base payout, and live receipt remain blocked and must not be implied by the demo.

## Later

The intended direction is direct, liquidity-backed payouts to additional destination networks and tokens. No additional chain or token is named, executable, or shown as supported until its registry entry, exact terms, recipient proof, chain/contract verifier, liquidity attestation, signer separation, recovery behavior, and independent receipt evidence all pass the same gates as the Base Sepolia test route. Mainnet, live quotes, automatic settlement, and automatic refunds remain out of scope.

## Next safe submission action

Record the existing closed public demo using the checked [two-minute checklist](docs/final-submission-sprint.md#two-minute-recording-checklist), upload it, verify anonymous playback, then complete the authenticated form and preserve its receipt. Do not push, deploy, migrate, change route flags, activate providers, or perform settlement as part of that recording. Any later release or financial test remains a separate approval sequence.
