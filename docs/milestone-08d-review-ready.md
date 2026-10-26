# Milestone 08D — Brand integration, release review, and submission readiness

Status: `08D_REVIEW_READY`

Release/submission verdict: **conditional / NO-GO for a funded release or final submission claim**. The reviewable local candidate is implemented and tested, but the production dependency audit is red, human/provider/live-chain evidence is incomplete, and the official submission still needs a public repository, reachable demo, two-minute video, and human form submission.

This milestone did not push, deploy, migrate staging, unlock a wallet, derive a Zcash address, approve a signature, broadcast a transaction, transfer funds, or pay out.

## Repository and provenance audit

- Branch before work: `feat/milestone-08a-consumer-privy` at `d90abbd3d8ec5a542516305e0576ff3427e1b622`; local `main` also pointed to that immutable 07A candidate.
- Remote: `origin` → `https://github.com/Alike001/zecori.git` for fetch and push.
- The complete pre-existing 08A–08C dirty worktree, migration 009, dependency changes, reports, design documents, `.thoughts/`, and brand exploration were inspected before editing. No reset, checkout, stash, or discard was used.
- Migrations 001–009 were read, hashed, and executed in a disposable PostgreSQL 17.7 database. Migration 009 adds hashed Privy subject mapping without storing email addresses or raw subjects.
- `.thoughts/research/2026-10-26-milestone-08b-reality.md` remains untracked and was never staged. No wallet database, private diagnostic, secret, address book, credential, or local environment file was staged.
- The historical Zecvia study is committed only as clearly marked 08C provenance. It is not loaded by the active product; Zecori is the provisional active customer-facing identity.

## Logical commits

1. `e9916d9` — `feat: add guarded identity and assistant capabilities`
2. `308600c` — `feat: integrate Zecori brand and product experience`
3. `788a315` — `docs: prepare Zecathon review and submission evidence`

The immutable 07A provenance remains below these commits at `d90abbd`. Every commit used explicit file paths, passed `git diff --cached --check`, and passed a staged filename/content secret-pattern review.

## Brand and product truth

- Active name: **Zecori**. Tagline: **Your Zcash. More possibilities.**
- Original mark: a concealed circular origin crossing a privacy boundary and branching to two visible evidence points. It is not a Z, shield, lock, or chain-link mark.
- The wordmark, favicon, dark/light semantic palettes, navigation, documentation, and private receipts share one system. Tested palette combinations range from 5.26:1 to 17.37:1 for the documented text/accent pairs.
- The hero and privacy documentation say that the Ironwood source is shielded while the Base Sepolia destination transaction is public. They disclose the experimental trusted LP, temporary custody, manual payout approval, and metadata observers.
- The exact executable route remains 0.01 TAZ / 1,000,000 zatoshis on Zcash testnet Ironwood → 1 test USDC / 1,000,000 atomic units on Base Sepolia 84532.
- Mainnet, live quotes, automatic settlement/refunds, Privy login, ERC-1271 contract wallets, handles, contacts, inbox, email notifications, and settings remain disabled or planned.
- Empty, loading, failure, microphone-refusal, invalid-address, wrong-network, unverified-destination, and unavailable-provider states are explicit. Motion is removed under `prefers-reduced-motion`; no animation simulates a completed financial transaction.

## Official Zecathon rules review

Checked 2026-10-26 against [the official Zecathon site](https://thezecathon.com/) and its live published submission form/data:

- submissions due 2026-10-28 at 23:59 UTC;
- exactly one track; selected track is Cross-Chain;
- one submission per account/team and open source/public repository by the deadline;
- required entry fields: project name, track, description up to 2,000 characters, repository URL, working demo URL, two-minute video URL, and public-repository confirmation;
- judging: privacy, usefulness, execution, and originality; privacy leaks are disqualifying;
- build-window originality applies; libraries are allowed; submissions remain sealed until judging.

`docs/zecathon-submission.md` contains the problem statement, Zcash privacy value, architecture, exact capability/limitation inventory, screenshot index, proof inventory, two-minute demo script, five-minute judge path, and roadmap. It does not claim that the entry has been submitted or accepted.

## Verification evidence

Completed locally on 2026-10-26:

- `corepack pnpm test`: 174 tests; 163 passed, 0 failed, 11 skipped. The skips are the 9 separately executed PostgreSQL cases and 2 opt-in live-network experiments.
- Disposable PostgreSQL 17.7, migrations 001–009: 9/9 integration tests passed, including passkeys, Privy mapping, owner isolation, replay resistance, allocation recovery, and lifecycle constraints. The disposable container and synthetic database were removed.
- WebAuthn browser smoke: passed with two virtual passkeys, session rotation/logout, re-login, private-history recovery, and unverified-destination blocking.
- Browser/accessibility/brand/localization/voice smoke: `MILESTONE_08D_BROWSER_A11Y_BRAND_SMOKE_PASSED`, including responsive layout, Zecori identity, persisted themes, reduced motion, English/French/Arabic behavior, microphone refusal, transcript correction, amount rejection, and no voice auto-submit.
- AI/voice/localization unit and API tests: included in the green suite. Live Groq/chat/speech validation remained blocked by the required explicit operator opt-in and was not run.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm build`: passed with Vite 7.3.7. The optional Privy chunk is 1,576.11 kB (441.36 kB gzip), above the 500 kB advisory; the default disabled path loads it dynamically only when configured.
- `corepack pnpm privacy:scan`: passed.
- `corepack pnpm security:gate`: passed.
- `corepack pnpm staging:gate`: all 27 static checks passed; no staging access or migration occurred.
- `corepack pnpm preflight`: correctly blocked on non-main branch, dirty/untracked review state, and absent production domain/secrets/backup configuration; the substantive code/static checks passed.
- `corepack pnpm audit --prod --audit-level high`: failed with 5 findings (3 moderate, 2 high). Both high findings are Zod memory-exhaustion paths under `@privy-io/react-auth` dependencies. Privy remains disabled; no unsupported cross-major Zod override was applied.
- `corepack pnpm outdated --format list`: reported available major upgrades for SimpleWebAuthn, Vite/plugin-react, TypeScript, Node types, and Lucide. These were not mixed into 08D without migration review.
- `git diff --check`: passed. Final tracked worktree is clean; only protected `.thoughts/` research remains untracked.

## Screenshots

- `docs/screenshots/zecori-home-dark.png`
- `docs/screenshots/zecori-home-light-mobile.png`
- `docs/screenshots/zecori-route-review.png`
- `docs/screenshots/zecori-evidence.png`

These were captured from the local production build. The route screenshot used a disposable empty PostgreSQL database. None depicts a completed transfer.

## Remaining blockers and risks

1. **Blocker — dependency audit:** Privy’s transitive Zod 3 copies remain under a high-severity advisory. Keep Privy disabled; resolve through a supported upstream dependency graph and rerun the full suite/audit.
2. **Blocker — human authentication:** real platform passkeys and real Privy email/Google login have not completed the two-account human runbook. Privy also lacks supplied tenant credentials.
3. **Blocker — live providers:** no approved live Groq chat, transcription, or TTS call; microphone/browser coverage and English/Arabic pronunciation remain unverified. Keep external AI/voice disabled.
4. **Blocker — first linked settlement:** no separately approved funded 0.01 TAZ → 1 test USDC settlement has been performed. There is no verified real receipt to present.
5. **Blocker — submission delivery:** public repository state, public demo URL, two-minute video URL, and sealed form submission are not verified.
6. **Risk — optional bundle size:** the Privy dynamic chunk is large and produces numerous Rollup annotation warnings.
7. **Risk — brand clearance:** Zecori is provisionally adopted but has no legal/domain clearance.
8. **Risk — deployment:** production secrets, domain, independent keyrings, backup location, and clean-main release conditions are intentionally absent from this local review.

## Human release/submission checklist

- [ ] Resolve the Privy/Zod audit or remove Privy from the release candidate; rerun audit, tests, typecheck, and build.
- [ ] Run two real human passkey accounts and, only if unblocked, real Privy email/Google acceptance; verify no account merge or embedded wallet.
- [ ] From the reviewed candidate, verify trusted read-only Zcash testnet and Base Sepolia endpoints without wallet unlocking or mutation.
- [ ] Confirm public repository history includes these explicit commits and excludes `.thoughts/`, secrets, wallet material, personal addresses, and local diagnostics.
- [ ] Publish a reachable demo only after a separate deployment review; do not migrate staging in this milestone.
- [ ] Record a two-minute demo using the script and real UI states; do not animate or claim a completed settlement.
- [ ] Separately approve the first shielded testnet settlement packet: candidate digest, backup/restore evidence, locked/watch-only source custody, source funding plus fees, destination test-USDC/gas liquidity, exact owner-controlled EOA, allocation, acceptance, payout, and independent receipt verification.
- [ ] Submit the official form from the registered human account before 2026-10-28 23:59 UTC and re-open it to confirm the final sealed state.

## Safe push commands

Review the three commits and the final 08D report commit first. From this branch, a non-force push command is:

```sh
git status --short --branch
git log --oneline d90abbd..HEAD
git push --set-upstream origin feat/milestone-08a-consumer-privy
```

Do not force-push. No push was performed by this milestone.
