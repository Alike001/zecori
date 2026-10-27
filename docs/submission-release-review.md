# Zecori submission release review

Review date: 2026-10-27
Branch: `feat/milestone-08a-consumer-privy`
Decision: **conditional / do not deploy yet**

This is the final local release-freeze record for Milestones 09A–09C. It does not authorize a push, merge, deployment, wallet operation, or funded settlement.

## Audited release commits

- `2a0d655` — private handles, contacts, non-paying request intents, migration 010, transactional outbox, and owner-scoped inbox.
- `0e2885b` — multilingual consumer UX, MDX documentation, Noir read-only compatibility boundary, and default-release Privy client exclusion.
- `e71bff8` — exact Git-revision Docker provenance, Compose propagation, explicit WebAuthn RP ID, and CI documentation validation.
- The evidence/screenshots and passkey-smoke safety guard are committed separately after the three implementation commits above.

Existing commits, branches, ignored private data, wallet paths, and `.thoughts/` were preserved. No blanket `git add`, reset, force operation, push, merge, deployment, wallet access, chain write, or durable database migration was performed intentionally.

## Verified product truth

- The only executable route remains exactly `0.01 TAZ` on Zcash testnet Ironwood to `1 test USDC` on Base Sepolia `84532`, at a fixed test rate through an experimental trusted liquidity provider.
- Passkeys protect owner-scoped requests, history, inbox, and receipts. An EIP-712 destination-control proof is purpose-limited and cannot transfer funds.
- Optional handles require explicit confirmation, apply uniqueness/reserved/confusable controls, expose only exact opt-in discovery, and never return wallet addresses.
- Handle request intents are non-paying. They cannot change an immutable recipient, create wallet authority, or bypass destination verification.
- The inbox is PostgreSQL-backed, owner-scoped, restart-durable, idempotent, and populated only from allow-listed redacted outbox events.
- The deterministic assistant and typed cards are usable without an external provider. Groq calls remain separately opt-in and were not exercised live.
- Voice UI states and bounded server contracts are tested, but live microphone/provider acceptance is not claimed.
- English is reviewed. French and Arabic render, including Arabic RTL, but security wording still needs human linguistic review.

## Verification evidence

| Check | Result |
|---|---|
| Full unit/API/integration suite on disposable PostgreSQL 17 | PASS — 182 tests, 180 pass, 2 explicitly skipped live-chain checks |
| Serial disposable PostgreSQL integration | PASS — 11/11 on a fresh empty database |
| Migration 010 on a new isolated database | PASS — migrations 001–010 applied; handle, outbox, and inbox tables present |
| Browser UX/accessibility/mobile/RTL | PASS — `MILESTONE_09C_BROWSER_UX_SECURITY_SMOKE_PASSED` |
| Virtual WebAuthn browser journey | PASS on explicit isolated origin — two credentials, logout/relogin, history recovery, unverified destination blocked |
| MDX routes and links | PASS — 17 pages, 13 required routes |
| TypeScript and production Vite build | PASS — one 387.78 kB application JS chunk; no Privy client chunk |
| Privacy scan and read-only security gate | PASS |
| Production dependency audit | PASS — no known vulnerabilities |
| Full development dependency audit | BLOCKED — 2 high and 3 moderate findings, all under disabled build-only `@privy-io/react-auth` |
| Noir Wallet browser acceptance | NOT RUN — no reviewed checksum-verified unpacked v1.0.40 extension was supplied |
| Live Groq, speech, Zcash, Base, and funded settlement | NOT RUN / NO-GO |

The first serial PostgreSQL rerun used a database already populated by the full suite and hit the intended global replay/identity uniqueness constraints. The required rerun on a new empty database passed 11/11; this is recorded to distinguish test isolation from a product defect.

## Privy release disposition

The server-side identity verifier remains feature-flagged and disabled. The React connector graph remains unsuitable to enable because its development-only tree contains affected Zod, UUID, and URI-decoding versions. The default Vite build defines `__PRIVY_UI_COMPILED__` as false, tree-shakes the client path, and keeps `@privy-io/react-auth` in `devDependencies`. The production dependency audit is clean. Re-enablement requires an upstream-compatible clean graph, a reviewed build change, tenant credentials, and real human acceptance.

## Public-demo readiness

The code enforces exact same-origin API access, an HTTPS `PUBLIC_ORIGIN` plus `TRUST_PROXY=1` in production, and an explicit `WEBAUTHN_RP_ID` equal to the public hostname or its registrable parent. Compose now binds the RP ID to `DOMAIN`, passes an exact 40-character `VCS_REF`, mounts secrets instead of baking them into the image, and keeps PostgreSQL on an internal network with a named persistent volume.

Public launch is still blocked until the final domain/TLS path, reverse-proxy forwarded headers, secret file ownership/modes, backup/restore, fresh migration, two physical passkeys, persistent restart behavior, monitoring, and hosted smoke tests are verified on a new environment. Mainnet and all automatic financial execution remain disabled.

## Staging-safety incident

The legacy passkey smoke previously defaulted to `http://localhost:8787`. During this review that port was already occupied by a durable staging service. One synthetic account/passkey labelled `TEST-ONLY browser account` appears to have been registered before the smoke timed out. No cleanup was attempted because that would further mutate durable staging. The script now refuses to run without both an explicit origin and `PASSKEY_SMOKE_ISOLATED=I_ACKNOWLEDGE_TEST_DATA_MUTATION`.

This unexpected staging write is a residual release blocker. The staging owner must inspect and decide how to handle the synthetic record using the project’s approved data-governance process.

## Hosted CI

PR #1 remains open at remote head `121472e54a5c37796adfb2b651e29284a94cd1c1`. Runs `40381454388`, `40381407411`, and `40381359705` all passed installation, tests, PostgreSQL, typecheck, build, privacy, and security, then failed at Docker because `VCS_REF` was not passed. The workflow fix now uses `--build-arg VCS_REF=${{ github.sha }}`. A new hosted result does not exist until an approved push.

## Human-controlled PR update

From the reviewed repository:

```bash
git status --short
git log --oneline origin/feat/milestone-08a-consumer-privy..HEAD
git diff --check origin/feat/milestone-08a-consumer-privy..HEAD
git push --dry-run origin HEAD:feat/milestone-08a-consumer-privy
git push origin HEAD:feat/milestone-08a-consumer-privy
gh pr view 1 --json url,state,headRefOid,statusCheckRollup
gh pr checks 1 --watch --interval 10
```

Do not push until the staging-safety incident and final diff are reviewed. Do not merge from these commands.
