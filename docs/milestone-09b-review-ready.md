# Zecori Milestone 09B — Review Ready

Status: `09B_REVIEW_READY`
Date: 2026-10-27
Branch: `feat/milestone-08a-consumer-privy`
Reviewed base revision: `121472e54a5c37796adfb2b651e29284a94cd1c1`

## Outcome

Milestone 09B converts the complete in-app guide set to reviewed, statically imported MDX; adds CI link and route validation; documents Noir Wallet v1.0.40 beta against official sources; and adds a deliberately read-only compatibility boundary. The 09A financial flow was reviewed from its real desktop and mobile captures and was not unnecessarily redesigned.

The first linked swap remains **NO-GO**. Mainnet, Noir Wallet, Privy, signing, transfers, address allocation, payouts, broadcasts, and durable staging remain disabled or unexercised. No commit, push, merge, deploy, wallet mutation, or financial operation was performed.

## CI repair and provenance

The 09A root-cause fix is preserved in `.github/workflows/ci.yml`:

```yaml
docker build --build-arg VCS_REF=${{ github.sha }} -t zecathon:${{ github.sha }} .
```

The Dockerfile's exact 40-character revision validation remains enabled and unchanged. The local CI-equivalent build used `121472e54a5c37796adfb2b651e29284a94cd1c1`; the resulting image label and non-root runtime user were inspected after the build.

Hosted GitHub Actions results are unchanged because this branch has not been pushed. PR #1 therefore cannot yet prove the repair on GitHub-hosted runners.

## MDX documentation

The documentation renderer uses `@mdx-js/rollup` before the Vite React plugin, a closed local component map, statically imported files, and a repository validation script. MDX is authored in-repository; it does not evaluate user-provided or remote MDX at runtime.

Available routes:

- `/docs/getting-started`
- `/docs/wallets-authentication`
- `/docs/noir-wallet`
- `/docs/swap-bridge`
- `/docs/route-availability`
- `/docs/privacy-custody`
- `/docs/ai-and-voice`
- `/docs/receipts`
- `/docs/order-recovery`
- `/docs/security`
- `/docs/api-architecture`
- `/docs/judge-walkthrough`
- `/docs/evidence`
- `/docs/roadmap`
- `/docs/brand-system`

All existing user and technical guide subjects remain represented. Route availability, wallet onboarding, privacy, security, recovery, roadmap, judge evidence, and disabled/future capabilities are labelled explicitly.

## Noir Wallet compatibility assessment

Reviewed release: `v1.0.40-beta.local.20261024101618.bf99d98`, source revision `bf99d98030c7df7e844f64c660b589d5ab7c6019`.

Relevant improvements include full recipient visibility, safer recovery-word hiding until explicit reveal, respected sync pauses, and dApp approval/response-timeout hardening. The release also documents unresolved restart recovery/automatic resend limitations and incomplete funded Shield Funds verification.

The official SDK exposes `window.noirwallet.zcash`; discovery does not connect, `getAccounts()` maps to `zcash_getAccounts`, and `connect()` is a user action. Mainnet and testnet are separate extension builds and runtime network switching is deprecated. However, the account response does not attest the extension's network build or an Ironwood-compatible pool. It therefore cannot satisfy Zecori's existing testnet + Ironwood + read-only capability contract.

Result: **Noir Wallet remains disabled and the first linked swap remains NO-GO.** The new adapter calls only `zcash_getAccounts` and then fails closed. Unit tests prove it does not request accounts, read balances, obtain payment addresses, sign, send, shield, or disconnect.

An isolated Chromium smoke harness is prepared, but was not run because no separately checksum-verified official testnet extension directory was supplied. It creates and destroys a temporary profile and never imports a seed phrase or touches an existing profile. See [the full compatibility note](./noir-wallet-v1.0.40-compatibility.md).

## UI review and screenshots

The actual 09A landing and route captures were reviewed at desktop and mobile sizes. The refined flow remains readable, responsive, and honest about the single fixed test route; no material flow regression justified redesigning financial steps.

09B documentation captures:

| View | Screenshot |
| --- | --- |
| Documentation desktop, 1440×1100 | [PNG](../artifacts/milestone-09b/after/docs-desktop.png) |
| Documentation mobile, 390×844 | [PNG](../artifacts/milestone-09b/after/docs-mobile.png) |
| Landing desktop | [PNG](../artifacts/milestone-09b/after/landing-desktop.png) |
| Landing mobile | [PNG](../artifacts/milestone-09b/after/landing-mobile.png) |
| Route desktop | [PNG](../artifacts/milestone-09b/after/route-desktop.png) |
| Route mobile | [PNG](../artifacts/milestone-09b/after/route-mobile.png) |

The 09A before/after screenshots remain in [the 09A review](./milestone-09a-review-ready.md).

## AI skill evaluation

Four skill-issue.in candidates were evaluated read-only against their original repositories: `ui-ux-pro-max-skill`, `agent-browser`, `web-design-guidelines`, and `accessibility-compliance`. None was installed or executed. The first two introduce broad executable/native and browser/profile trust boundaries; the third fetches mutable remote guidance at use time; the fourth's selected guidance is narrow but its installation surface is broader than this task requires. Existing repository-specific browser and accessibility checks remain the safer fit. See [the evaluation](./ai-skill-evaluation.md).

## Verification evidence

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | PASS; lifecycle build scripts remain blocked by pnpm policy |
| `pnpm docs:validate` | PASS — 15 pages and all required routes/metadata/internal links |
| `pnpm test` with disposable PostgreSQL | PASS — 177 total, 175 passed, 2 intentional live skips, 0 failed; security gate passed |
| `pnpm test:postgres` on fresh disposable PostgreSQL | PASS — 9/9 |
| Real WebAuthn browser smoke | PASS — two passkeys, revoked session, private history, destination block |
| `pnpm test:browser` | PASS — full 09B guest/docs/wallet/security journey |
| `pnpm test:a11y` | PASS — semantics, RTL, reduced motion, keyboard/mobile assertions |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS; existing optional Privy chunk-size advisory remains |
| `pnpm privacy:scan` | PASS |
| `pnpm security:gate` | PASS |
| CI-equivalent Docker build | PASS — exact revision build argument preserved |
| `git diff --check` | PASS |
| `pnpm audit --audit-level high` | **FAIL** — 5 findings: 2 high and 3 moderate |

The two high findings are Zod memory-exhaustion advisory `GHSA-mrhx-c7xc-m3w5`, reached through two transitive `@privy-io/react-auth` dependency paths. The three moderate findings are transitive `uuid` and `decode-uri-component` advisories in the same Privy/WalletConnect graph. A cross-major forced override was not applied. Privy remains disabled by default, but the findings must be remediated or formally reviewed before enabling it or declaring production readiness.

## Mainnet and live-chain blockers

- No funded end-to-end Zcash-to-Base settlement has been approved or verified.
- Noir Wallet cannot attest testnet and Ironwood compatibility through the reviewed provider response.
- Privy's optional dependency graph has unresolved high-severity audit findings and its live tenant flow is unverified.
- Live Zcash/Base RPC behavior, provider liquidity, operator funding, refunds, reorg recovery, and payout operations remain untested.
- Durable staging, external penetration testing, and an independent security audit were not available.
- The existing large optional Privy browser chunk remains a performance concern.

## Files changed for 09B

- `.github/workflows/ci.yml` — preserves exact revision provenance and adds MDX validation.
- `package.json`, `pnpm-lock.yaml`, `vite.config.ts`, `src/mdx.d.ts` — MDX build integration and scripts.
- `src/docs/components.tsx`, `src/docs/registry.ts`, `src/docs/pages/*.mdx` — reviewed component map, route registry, and 15 guides.
- `src/ProductSurfaces.tsx`, `src/styles.css`, deleted `src/lib/docs-content.ts` — MDX rendering and responsive guide presentation.
- `scripts/validate-docs.mjs` — route, metadata, and internal-link validation.
- `src/lib/product-capabilities.ts`, `src/lib/noir-wallet-readonly.ts`, `src/lib/noir-wallet-readonly.test.ts` — disabled/fail-closed Noir compatibility boundary.
- `scripts/noir-wallet-isolated-smoke.mjs` — isolated, testnet-only read-only harness.
- `scripts/milestone-06a-browser-smoke.mjs` — MDX/Noir guide assertions and captures.
- `docs/noir-wallet-v1.0.40-compatibility.md`, `docs/ai-skill-evaluation.md`, `README.md` — compatibility, trust, and operator guidance.
- `.thoughts/research/2026-10-27-milestone-09b-reality.md`, `.thoughts/verification/2026-10-27-milestone-09b.md` — research and traceability evidence.
- `artifacts/milestone-09b/after/` — desktop/mobile landing, route, and documentation captures.

The worktree also contains the previously uncommitted 09A files listed in [the 09A review](./milestone-09a-review-ready.md), plus older untracked research. They were preserved.

## Scoped commit proposal

No commit was created. Because 09B depends on the uncommitted 09A UI and browser harness, the safest reviewable proposal is one explicit 09A+09B candidate commit:

```text
feat: prepare Zecori 09A and 09B review candidate
```

Reviewers should inspect the complete index before committing. Do not use `git add .` or `git add -A`; the worktree contains intentionally preserved untracked research and artifacts.

## Exact safe commands for PR #1

Run these only after reviewing the local diff and deciding which evidence files belong in the PR:

```sh
git status --short
git diff --check
git diff --stat

git add -- \
  .github/workflows/ci.yml README.md docs/zecori-brand-guidelines.md \
  docs/milestone-09a-review-ready.md docs/milestone-09a-ux-audit.md \
  docs/milestone-09b-review-ready.md docs/noir-wallet-v1.0.40-compatibility.md \
  docs/ai-skill-evaluation.md index.html package.json pnpm-lock.yaml \
  public/favicon.svg scripts/milestone-06a-browser-smoke.mjs \
  scripts/passkey-browser-smoke.mjs scripts/noir-wallet-isolated-smoke.mjs \
  scripts/validate-docs.mjs src/App.tsx src/ProductSurfaces.tsx src/styles.css \
  src/lib/docs-content.ts src/lib/product-capabilities.ts \
  src/lib/noir-wallet-readonly.ts src/lib/noir-wallet-readonly.test.ts \
  src/docs src/mdx.d.ts vite.config.ts

git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: prepare Zecori 09A and 09B review candidate"
git push origin feat/milestone-08a-consumer-privy
gh pr view 1 --web
gh run list --branch feat/milestone-08a-consumer-privy --limit 5
```

The `git add` list intentionally excludes `.thoughts/` and `artifacts/`. Add individually reviewed evidence paths only if the repository policy requires them. Pushing is a future, explicitly approved action; it was not performed here.

The disposable `zecori-09b-postgres` container, `/tmp/zecori-09b-keyring`, and `zecori-09b-local` verification image were removed after the recorded checks.

## Safe preview commands

Static public/docs preview:

```sh
pnpm install --frozen-lockfile
pnpm docs:validate
pnpm build
pnpm preview
```

Disposable browser journey and fresh local captures:

```sh
ZECORI_SCREENSHOT_DIR=artifacts/milestone-09b/after pnpm test:browser
```

The isolated Noir harness must not be pointed at an existing browser profile. It may be run only after separately obtaining and verifying the official testnet-only extension directory:

```sh
NOIR_TESTNET_EXTENSION_DIR=/absolute/path/to/reviewed-unpacked-testnet-extension \
NOIR_TEST_APP_URL=http://127.0.0.1:4173 \
pnpm test:noir-wallet:isolated
```
