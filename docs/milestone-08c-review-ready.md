# Milestone 08C — Review ready

Status: `08C_REVIEW_READY`

Review date: 2026-10-26. Branch: `feat/milestone-08a-consumer-privy`. Existing 08A/08B working-tree changes were preserved. No commit, push, deployment, production-key change, durable-staging access, wallet access, financial operation, Zcash address derivation, signing, or broadcast was performed.

## Delivered behavior

- The deterministic assistant explains the canonical route and privacy boundary, reports capability availability, prepares a non-authorizing review card, and returns owner-authorized status/recovery cards in English, French, and Arabic.
- Every structured card is built and validated from the route registry or owner-scoped backend data. Unsupported routes, wrong amounts, invented prices/providers/hashes, unsupported completion claims, prompt injection, private wallet material, and cross-account requests fail closed.
- Groq chat remains server-only, stateless, explicitly opted in, time-bounded, response-bounded, and limited to one retry for network, `429`, or `5xx` failure. Rate limit, timeout, downtime, and malformed-response states disclose that no action occurred.
- Authenticated voice recording now has disclosure consent, browser permission, requesting/recording/processing/review/playback/error states, a 30-second/2-MB application limit, and a 500-ms minimum. Transcripts are editable and are copied to chat only after review; they never auto-submit.
- Server-side Groq transcription uses `whisper-large-v3-turbo` with English, French, or Arabic hints. Voice output is restricted to the documented English and Saudi-Arabic Orpheus models; French and every other language use text only.
- Raw audio is held in browser/server memory, is not written to the application database or disk, and the server buffer is zeroed after the provider call. Groq's own data handling still requires human acceptance before enablement.
- `/docs/ai-and-voice`, `/docs/roadmap`, and the judge walkthrough now expose provider/privacy limits, examples, verified/experimental/disabled/planned status, blocked paths, and a locale matrix. Docs honor Arabic RTL and label French/Arabic security copy as awaiting human review.
- Zecvia is only a provisional exploration. Three original marks and an identity board exist under `public/brand-exploration/`; current Zecathon names, metadata, repository, accounts, and domains remain unchanged.

## Capability status

| Capability | Status | Evidence / remaining boundary |
|---|---|---|
| Guest route exploration | `VERIFIED` | Public API and browser smoke. |
| Passkey accounts/recovery | `VERIFIED` | PostgreSQL integration plus two-passkey browser smoke. |
| Privy email/Google | `DISABLED` | Runtime default-off; unresolved supported dependency graph and no live tenant acceptance. |
| Fixed `0.01 TAZ -> 1 test USDC` route | `EXPERIMENTAL` | Registry and guarded workflow tests pass; first linked funded settlement remains NO-GO. |
| Destination proof | `EXPERIMENTAL` | EIP-712/owner-bound tests pass; broader real-wallet acceptance is absent. |
| Backend lifecycle/recovery | `VERIFIED` | Disposable PostgreSQL concurrency, restart, audit, and isolation tests. |
| Private/redacted receipts | `VERIFIED` | Authorization and redaction tests. |
| Live quotes | `DISABLED` | No quote source; fixed terms are explicitly not a market quote. |
| Automatic settlement/refunds | `DISABLED` | No public signing, broadcast, payout, allocation, or refund mutation. |
| Mainnet | `DISABLED` | No registered route or wallet path. |
| Deterministic assistant | `VERIFIED` | Works without provider credentials and uses trusted facts. |
| Groq assistant | `EXPERIMENTAL` | Contract tests pass; no approved live model/quota request. |
| Voice | `EXPERIMENTAL` | UI/API/provider contracts pass; real microphones, provider calls, accuracy, and pronunciation remain untested. |
| Zecvia exploration | `EXPERIMENTAL` | Three original concepts; naming, trademark, and domains are not cleared. |
| Handles, inbox, email, settings | `PLANNED` | Design/navigation only; no shipping service. |

The machine-readable source is `src/lib/product-capabilities.ts`.

## Provider facts and limits

The live validator requires the exact inventory IDs `openai/gpt-oss-20b`, `whisper-large-v3-turbo`, `canopylabs/orpheus-v1-english`, and `canopylabs/orpheus-arabic-saudi`, then records quota headers. It was not run because explicit approval was not given.

Groq's public Developer base table checked on 2026-10-26 lists 30 RPM / 1,000 RPD / 8,000 TPM / 200,000 TPD for `openai/gpt-oss-20b`; 20 RPM / 2,000 RPD / 7,200 audio-seconds hourly / 28,800 daily for Whisper; and 10 RPM / 100 RPD / 1,200 TPM / 3,600 TPD for each configured Orpheus model. These are published base limits, not Zecathon-account quotas. Exact availability and quotas remain unverified until an approved request checks the Groq account Limits page and live headers. Sources: [rate limits](https://console.groq.com/docs/rate-limits), [speech to text](https://console.groq.com/docs/speech-to-text), and [Orpheus text to speech](https://console.groq.com/docs/text-to-speech/orpheus).

## Language and human acceptance matrix

| Language | UI / RTL | AI text | Recognition | Voice output | Human acceptance needed |
|---|---|---|---|---|---|
| English | Partial LTR | Supported | Configured | English Orpheus | Security-copy review, physical-mic flow, recognition and pronunciation. |
| French | Partial LTR | Supported | Configured | Text only | Native review of every security warning and recognition accuracy. |
| Arabic | Partial RTL | Supported | Configured | Saudi-Arabic Orpheus | Native security/RTL review, dialect fit, recognition and pronunciation. |

Addresses, hashes, chain IDs, `TAZ`, and `USDC` are preserved verbatim. No locale is claimed complete. Human reviewers must test denial/permission transitions on Chrome, Safari, Firefox, Android, and iOS; accented and dialectal speech; silence/noise; wrong amounts; TAZ/USDC pronunciation; screen-reader announcements; and provider privacy terms.

## Security and dependency disposition

`pnpm audit --json` reports 0 critical, 2 high, and 3 moderate findings, all observed through the disabled Privy client graph: high Zod `GHSA-mrhx-c7xc-m3w5`; moderate UUID `GHSA-w5hq-g745-h8pq`; and moderate `decode-uri-component` `GHSA-vcc3-ghjq-m6fr` (multiple dependency paths account for the counts). Installed Privy packages are already the current checked releases. No incompatible Zod major-version override or other unsupported override was introduced. Privy remains fail-closed and off.

The assistant and voice endpoints require origin/CSRF checks and authentication for private behavior. No model tool can create an order, allocate an address, sign, broadcast, approve a payout, authorize a payment, operate a wallet, or decide an operator action. Provider prompts exclude raw private account/order records; private-looking user input is rejected before a provider call.

## Verification evidence

Final results on the current tree:

- Full unit/API/disposable-PostgreSQL suite: **174 total; 172 passed; 0 failed; 2 skipped**. The skips are the explicit opt-in read-only Base reference transaction and Zcash Experiment 03 checks. Migrations 001–009 applied.
- Targeted AI/voice/i18n/provider suite: **38/38 passed**.
- TypeScript: passed.
- Production build: passed with Vite 7.3.7. The optional disabled Privy chunk remains 1,576.11 kB (441.36 kB gzip) and triggers the existing chunk-size advisory.
- Browser, accessibility, multilingual, RTL, and voice-state smoke: passed as `MILESTONE_08C_BROWSER_A11Y_I18N_SMOKE_PASSED`, including mic refusal fallback, transcript correction, wrong-amount rejection, and no voice auto-submit.
- WebAuthn browser smoke: passed as `PASSKEY_BROWSER_SMOKE_PASSED` with two passkeys, session revocation, cross-session history, account isolation, and unverified-destination blocking.
- Privacy scan: passed. Read-only security gate: passed. `git diff --check`: passed.
- Dependency audit: intentionally non-green at 2 high / 3 moderate; Privy remains disabled.
- Disposable database/container and synthetic keyring were removed after testing. No durable environment was touched.

Not run: real Groq chat/STT/TTS, exact account quotas, physical microphone acceptance, live English/French/Arabic recognition, live English/Arabic pronunciation, Privy login, live Base/Zcash checks, real wallets, a linked funded order, settlement/refund/payout, mainnet, staging, deployment, commit, or push.

## 08C changed files

- AI reliability: `server/agent-gateway.ts`, `server/agent-provider.ts`, `server/agent-gateway.test.ts`, `server/groq-responses-provider.test.ts`, `scripts/validate-live-groq.ts`, `src/lib/agent-cards.ts`.
- Voice: `server/speech-provider.ts`, `server/speech-provider.test.ts`, `server/public-api.ts`, `server/app-server.ts`, `server/app-server.test.ts`, `src/App.tsx`, `src/lib/order-api.ts`, `src/lib/voice.ts`, `src/lib/voice.test.ts`, `.env.example`.
- Localization/docs/product truth: `src/lib/i18n.ts`, `src/lib/i18n.test.ts`, `src/lib/docs-content.ts`, `src/lib/product-capabilities.ts`, `src/lib/product-capabilities.test.ts`, `src/ProductSurfaces.tsx`, `src/styles.css`, `README.md`, `docs/ai-and-voice.md`.
- Browser acceptance: `scripts/milestone-06a-browser-smoke.mjs` and `scripts/passkey-browser-smoke.mjs`.
- Brand exploration: `docs/zecvia-brand-exploration.md` and `public/brand-exploration/zecvia-concept-board.png`, `zecvia-veiled-route.svg`, `zecvia-quiet-relay.svg`, `zecvia-evidence-window.svg`.
- Review artifact: `docs/milestone-08c-review-ready.md`.

Several listed tracked files already contained preserved 08A/08B edits before this milestone; this work did not discard or rewrite unrelated user changes.

## Judge walkthrough

1. Open `/docs/roadmap` and compare the four evidence statuses.
2. In the assistant, ask “Which route is supported?”, “Prepare a review”, and—while signed in—an owned request status. Inspect trusted cards and the no-authority fields.
3. Try an unsupported route, wrong amount, invented price, prompt injection, and another account's request. Each is blocked without action.
4. Sign in, accept the voice disclosure, deny microphone permission, and observe text fallback. Then use the test mock flow to review/correct a transcript; verify it does not submit automatically.
5. Switch among English, French, and Arabic; inspect fixed financial tokens and Arabic RTL. Point out the human-review warning.
6. Open `/docs/ai-and-voice` for provider/privacy limits and `/docs/brand-exploration` for the three provisional concepts and clearance boundary.
7. End on the disabled Privy audit and the still-unmet first linked settlement gate.

The release boundary remains **NO-GO** for Privy, live provider claims, and the first linked funded Zcash-to-Base settlement.

`08C_REVIEW_READY`
