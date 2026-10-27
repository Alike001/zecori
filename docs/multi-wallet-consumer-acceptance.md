# Multi-wallet consumer acceptance audit

- Date: 2026-10-27
- Branch: `feat/multi-wallet-consumer-acceptance`
- Base: `47ea868` (`main`, PR #4 merge)

## Verdict

**Conditional pass for the consumer implementation. No-go for financial enablement.**

The wallet-neutral selector, owner-scoped external-wallet payment instructions, Base recipient controls, disposable fixtures, responsive UI, documentation, and local quality gates satisfy this sprint. Route and liquidity flags remain off. Noir payment sending and all named external Zcash wallets remain unverified; no transaction, push, deployment, production secret, or financial flag was used.

## Artifacts checked

- Sprint acceptance brief in the initiating request.
- Existing Noir adapter and review-only payment model.
- Existing encrypted receiver allocation, destination intent, EIP-712/optional ERC-1271 control proof, settlement lifecycle, and public API boundaries.
- Changed source, tests, browser smoke, documentation, package lock, and production build.
- Existing PostgreSQL settlement, replay, encryption, ownership, duplicate-payment, privacy, and audit tests.

## Requirement traceability

| Requirement | Implementation evidence | Verification evidence | Result |
| --- | --- | --- | --- |
| Reuse existing architecture | Generic payment-ready presentation composes the existing owner-scoped API response, immutable route terms, allocation lifecycle, and Noir review model; no parallel order or wallet backend was introduced. | Full unit/API/server suite and disposable PostgreSQL suite. | Pass |
| Wallet-neutral source selector | Consumer choices are “Connect Noir Wallet” and “Use another Zcash wallet.” Noir remains guarded and cannot satisfy request readiness; external selection makes no named-wallet claim. | Browser wallet flow plus Noir installed/missing, connect/reject, balance, stale, account and chain fixture tests. | Pass |
| Public demo remains nonfinancial | Closed readiness hides wallet/request controls; payment instructions require authenticated owner data and `PAYMENT_READY`. | Browser closed-route checks, guest API rejection, premature-publication rejection, security gate. | Pass |
| Exact external-wallet `PAYMENT_READY` | Full receiver, Zcash testnet/Ironwood-only source, exact `0.01` TAZ amount, Base chain/token/recipient, order ID, expiry, fees/refund disclosure, copy control, and plain-text receiver QR. Expiry/term mismatch/lifecycle advance fail closed. | `payment-ready.test.ts` plus browser exact-receiver/copy/QR/terms/mobile checks. | Pass |
| No premature receiver or transparent fallback | Receiver renders only from valid owner-scoped payment instructions after allocation. UI explicitly forbids transparent funds and contains no fallback. | PostgreSQL allocation/publication tests, browser receiver-withheld check, source-policy tests. | Pass |
| Preferred connected Base recipient | Connected EIP-1193 wallet is labeled preferred; chain/account are read before review and checked again before/after signing. | Wallet-readiness and browser wrong-network tests. | Pass |
| Manual recipient is intent, not proof | Manual entry copy states intent-only; EIP-55/zero/hidden-character checks run locally, and the exact wallet must still sign. | EVM address, clipboard integrity, wallet intent, challenge and signer-recovery tests. | Pass |
| Chain, token, recipient and proof binding | Base Sepolia `84532`, canonical test-USDC contract, recipient, owner/session, origin, nonce and expiry are immutable inputs; account/chain changes discard the proof. | Server wallet-control and disposable PostgreSQL single-use/concurrency/restart tests. | Pass |
| No silent recipient substitution | Client compares the issued challenge recipient with the reviewed recipient; wallet signer and post-sign account must match; server recovers the exact signer. | Destination signature, mismatch, conflict, and two-account isolation tests. | Pass |
| Disposable acceptance fixtures | Missing/installed Noir, consent accept/reject, unsupported build/configuration, unsynced/insufficient/stale balance, account/chain switching, invalid/pasted addresses, QR/copy integrity, expiry, lifecycle advance, double-payment prevention, and privacy redaction are covered without reusable wallet data. | Focused unit tests, browser smoke, isolated PostgreSQL container. | Pass |
| Desktop/mobile, themes, identity and footer | New panels use existing tokens/components, collapse on narrow screens, pass both-theme contrast, and retain the required Zecathon footer label. | Browser mobile/desktop overflow, theme persistence, semantics, and WCAG contrast checks. | Pass |
| Documentation and compatibility truth | README, product MDX, Noir evidence, and wallet compatibility matrix distinguish integrated, guarded, verified, disabled and unverified paths. | MDX documentation validation and browser docs checks. | Pass |

## Quality gates

| Gate | Result |
| --- | --- |
| `pnpm test` | Pass: 207 tests, 194 passed, 13 expected skips; the 11 database skips were run separately and passed, while two live-chain tests stayed intentionally disabled. |
| Disposable PostgreSQL 17.7 integration | Pass: 11/11 using an isolated container and test-only credentials; container removed afterward. |
| `pnpm test:browser` | Pass: multi-wallet browser acceptance, responsive layout, theme, accessibility semantics, privacy and double-payment checks. |
| `pnpm typecheck` | Pass. |
| `pnpm build` | Pass. |
| `pnpm privacy:scan` | Pass. |
| `pnpm security:gate` | Pass. |
| `pnpm test:contrast` | Pass: WCAG 2.2 AA token pairs in dark and light themes; minimum ratio `5.2:1`. |
| `pnpm docs:validate` | Pass: 17 MDX pages and 13 required routes. |
| `git diff --check` | Pass. |

## Deviations from plan

- No wallet transaction or linked funded test was conducted, as explicitly prohibited by the sprint.
- The QR encodes only the exact receiver as plain text. It does not use an invented Zcash URI or include an amount because no multi-wallet URI behavior has been accepted.
- Noir remains a connection/readiness integration only. Its current provider surface exposes version compatibility but not origin-verifiable testnet-build or Ironwood-spendability evidence.

## Gaps and risks

- No named external Zcash wallet is payment-compatible until its disposable testnet evidence is completed.
- Noir cannot proceed past guarded readiness without a trustworthy build/network/pool attestation or an independently reviewed equivalent.
- Live final-domain EIP-1193 behavior and optional ERC-1271 contract-wallet behavior remain separate acceptance items.
- A real QR scanner/wallet interoperability pass remains required for each wallet eventually added to the compatibility matrix; current evidence proves exact payload generation and rendering, not third-party wallet parsing.

## Final acceptance steps

1. Keep public route, liquidity, ERC-1271, and all financial execution flags off.
2. Obtain the exact reviewed Noir testnet extension artifact and checksums, or choose one explicitly named external Zcash wallet for acceptance.
3. Create a fresh disposable browser profile and a new unfunded test-only wallet; never import an existing phrase or profile.
4. Verify install/missing, consent accept/reject, lock/unlock, wrong build/network, unsynced/stale balance, account switch, chain switch, restart, and account removal. Preserve redacted evidence only.
5. With a separately authorized operator fixture, create one owner-bound request, prove the exact Base Sepolia EOA recipient, accept it, and allocate one fresh dedicated Ironwood receiver.
6. Independently compare the full visible receiver, copied value, and decoded QR payload byte-for-byte. Confirm chain, exact amount, token contract, recipient, order ID and expiry.
7. Confirm the chosen wallet can prepare an exact direct shielded testnet payment with no transparent intermediate or fallback. Do not broadcast during this inspection step.
8. Re-run typecheck, full tests, isolated PostgreSQL integration, browser/a11y, build, privacy scan, security gate, documentation and contrast checks on the candidate revision.
9. Obtain product and security review of the captured evidence. Update the compatibility matrix for only the exact wallet/build tested.
10. Only under a new explicit transaction authorization, perform one test-asset payment and independently verify the exact Ironwood output, receiver, amount, confirmation depth, duplicate prevention and Base settlement. Keep all public financial flags off until that evidence is accepted.

## Evidence log

- No production secrets were read or used.
- No wallet process was started by this sprint.
- No wallet was unlocked, funded, signed with, or asked to broadcast.
- No push, deployment, production mutation, or financial feature enablement occurred.
- The disposable PostgreSQL container and test credentials were removed after the integration run.
