# Final functionality and submission sprint

Evidence date: 2026-10-28. This report separates application checks from real-chain evidence. It authorizes no push, deployment, production migration, route-flag change, wallet access, signature, broadcast, payout, provider request, or microphone recording.

## Release and hosting state

- GitHub `main` is public and points to `8374687469b701b61c39e8495cf783ab1d9f316b`.
- The working branch began at `b9264321769315ec20632d7d136ec7f48fb37d83`, three commits ahead of `main` and one commit ahead of its remote. A local safety branch, verified Git bundle, and pre-sprint `.thoughts` archive protect that state.
- The live origin returns HTTPS 200 for `/`, `/health/live`, `/health/ready`, and the docs SPA. TLS is valid for `zecori.iamalikex.tech`; the guarded smoke confirms route requests remain disabled.
- Public responses identify Render as the origin. DNS is only a CNAME from `zecori.iamalikex.tech` to `zecori-judge.onrender.com`. The domain/DNS service provides naming, not backend compute.
- No Render credential is available locally. The exact deployed Git SHA, dashboard-only environment values, deploy log, and current Neon console state therefore remain **unverified**. Public behavior matches the checked-in closed-route contract, but that is not SHA attestation.

## Cross-Chain requirement fit

| Requirement | Evidence | Status |
| --- | --- | --- |
| Shielded Zcash source | Fixed route and verifier require Zcash testnet Ironwood shielded funds; transparent and wrong-pool inputs fail closed | PASS in code/tests; live source transaction BLOCKED |
| Truthful destination privacy | UI/docs state that Base Sepolia recipient, amount, token transfer, and transaction hash are public; operator correlation is disclosed | PASS |
| Genuine interoperability | Zcash and Base evidence adapters, signed relay, operator gates, and receipt linkage exist | PASS in integration tests; real linked transfer BLOCKED |
| Independent settlement evidence | Two-stage Zcash verification, canonical Base receipt verification, duplicate/reorg checks, and authenticated receipts pass fixtures/PostgreSQL | PASS in tests; live evidence BLOCKED |
| Originality | Git history and Zecori-specific route, privacy, lifecycle, and UI implementation exist | Evidence prepared; organiser decides |
| Working public demo | HTTPS origin, health/readiness, SPA, and guarded judge smoke pass with route closed | PASS as a nonfinancial demo |
| Submission fields | Public repo, description, demo URL, exact one-track selection, and two-minute script are prepared | BLOCKED on uploaded video URL and human form receipt |

The official live event assets list Cross-Chain as swaps, bridges, and intents that reach other chains without unshielding in transit. They also require one track, a public repository, a working demo, a two-minute video, and a description of at most 2,000 characters. The public criteria are privacy, usefulness, execution, and originality. The final authenticated submission remains a human action.

## Isolated future variable amounts

`server/test-variable-quote.ts` is a test-only, unconnected quote engine. Construction fails unless an isolated caller explicitly enables it. No public API, UI, route registry, Render variable, or fixed-route term imports it.

It accepts only integer atomic strings and an operator-approved test-rate record. Gross destination output rounds down; proportional fees round up; fixed fees then apply. Min/max source amounts, provider approval start/expiry, quote expiry, exact UUID order/recipient/amount/approval binding, and destination-liquidity capacity are enforced. Active quotes reserve capacity once, idempotent retries return the same quote, expiry releases capacity, and consumed capacity remains allocated. The output labels the rate `operator-approved-test-rate-not-market-price`.

This is future acceptance code, not a live quote, market price, liquidity promise, or executable route. The current `0.01 TAZ → 1 test USDC` fixed route is unchanged.

## Domain and origin decision

Do not move the origin before submission. The current Node web service serves the frontend and `/api/v1` on one origin and keeps WebAuthn, cookies, CSRF, CSP `connect-src`, and API ownership simple.

| Concern | Current same-origin Render + Neon | Separate static edge frontend |
| --- | --- | --- |
| Compute | Node web service provides server compute; Neon provides PostgreSQL | Static hosting provides no backend compute; Render API still required |
| Passkeys | RP ID and origin are exactly `zecori.iamalikex.tech` | New hostname/RP scope may require new credentials and acceptance |
| Cookies/CSRF | Host-only secure cookies and exact-origin checks | Cross-origin cookies need deliberate Domain/SameSite/CORS/credentials design and widen review surface |
| API latency | One browser origin; Render-to-Neon latency remains | Edge HTML may be faster, but every dynamic action still crosses to Render and can cold-start |
| Security | CSP is same-origin and no public API CORS is needed | Requires strict CORS, preflight/cache review, origin allowlists, and protection against split-host misconfiguration |

## AI and voice boundary

- Deterministic Help passes and works without a provider.
- The reviewed Groq model is exactly `openai/gpt-oss-20b` at `https://api.groq.com/openai/v1`. A private mode-0600 server key file is required.
- Model calls also require exact `AI_EXTERNAL_REQUESTS_APPROVED=I_APPROVE_CHARGEABLE_MODEL_REQUESTS`. One-shot validation requires its additional approval. Speech separately requires `VOICE_ENABLED=1` and `VOICE_EXTERNAL_REQUESTS_APPROVED=I_APPROVE_CHARGEABLE_SPEECH_REQUESTS`.
- The gateway blocks private wallet/session-shaped input, exposes no payment tools, and cannot approve or execute settlement. Provider retention/abuse logging may apply; application memory-only handling is not a provider zero-retention promise.
- Mock transcription and speech, consent/auth/CSRF, transcript correction, microphone refusal, unsupported language, private-payload refusal, and audio-buffer clearing pass. No live Groq call or physical microphone capture occurred.

## Settlement readiness

Read-only readiness passed the private Wallet A reference boundary, Base Sepolia chain/token, bound operator identities, and sufficient test-USDC/gas balances. It blocked on live Wallet A funding evidence, a persistent synchronized watch-only zecd cookie/state, the reviewed Noir artifact, and—in that snapshot—an absent database URL. A later disposable PostgreSQL run passed all 11 integration tests and was removed.

The zero-card proof available now is code/configuration provenance, walletless upstream/TLS evidence, read-only Base evidence, operator-balance evidence, and isolated recovery/relay/receipt tests. A persistent watch-only verifier still needs durable compute and storage, an explicitly authorized UFVK ceremony, backup/restore, restart evidence, monitoring, and authenticated relay keys. Free DNS and free Render are not substitutes. CipherPay is rejected as trusted evidence and is not part of the accepted topology.

## Verification matrix

| Gate | Result |
| --- | --- |
| Full local suite | PASS — 217 total: 204 pass, 13 expected skips; live-chain skips separated below |
| Fresh PostgreSQL | PASS — 11/11 serial integration tests |
| Variable-quote unit tests | PASS — 6/6, included in full suite |
| Browser/mobile/accessibility | PASS — responsive, RTL, reduced motion, two-account fixture isolation, wallet/privacy/payment states |
| Contrast | PASS — WCAG 2.2 AA; minimum measured ratio 5.2 |
| Privacy and read-only security gates | PASS |
| MDX docs and production build | PASS — 17 pages; Vite production build |
| Live public judge smoke | PASS — route requests disabled |
| Production dependency audit | PASS — no known production vulnerabilities |
| Full dependency audit | BLOCKED — known dev-only Privy connector Zod advisories remain; Privy is compiled out/disabled |
| Dedicated-production preflight | BLOCKED as expected — feature branch, changed tree, and absent dedicated-host secret/backup paths |
| Live Groq/voice | BLOCKED — no credential/charge/privacy approval; not run |
| Persistent watch-only zecd | BLOCKED — no approved durable host/UFVK/restart evidence |
| Real 0.01 TAZ source | BLOCKED — no authorized allocation, send, or txid |
| Real Base payout | BLOCKED — no authorized signature, broadcast, or txid |
| Live linked receipt | BLOCKED — no two-chain on-chain evidence exists |
| Video and final form receipt | BLOCKED — human recording/upload/submission remains |

## Final go/no-go

| Decision | Verdict | Reason |
| --- | --- | --- |
| Use the public site for a truthful nonfinancial judge walkthrough | GO | Public demo and closed-state disclosures are verified |
| Claim working AI/voice, live quotes, or a completed swap | NO-GO | No approved live provider or on-chain evidence |
| Enable route/liquidity/variable-quote flags | NO-GO | Acceptance and financial authorization are absent |
| Submit the final Cross-Chain entry now | **NO-GO** | Upload the two-minute video, record its URL, and complete the human form; genuine live interoperability remains explicitly unproven |

## Two-minute recording checklist

- [ ] Use `https://zecori.iamalikex.tech`; confirm the route says unavailable before recording.
- [ ] Show “0.01 TAZ → 1 test USDC” and say “fixed test terms, not a market quote.”
- [ ] Show “Ironwood shielded source” and the transparent Base Sepolia/privacy/custody disclosure.
- [ ] Show the closed walkthrough: no receiver, allocation, signature, transaction, or receipt is created.
- [ ] Use only a disposable account or existing sanitized screenshots; reveal no address, cookie, key, or private evidence.
- [ ] Ask deterministic Help a privacy/refund question and say provider-backed AI and voice are off.
- [ ] Show the evidence page and state that the live funded swap, AI/voice, mainnet, and additional networks are blocked.
- [ ] Do not show fixture data as a real transfer or receipt.
- [ ] Keep the final cut at or below two minutes, upload it to a judge-accessible URL, and verify anonymous playback.
- [ ] Paste the exact repo, demo, and video URLs into the authenticated form; select Cross-Chain once; submit before `2026-10-28 23:59 UTC`; save the receipt.
