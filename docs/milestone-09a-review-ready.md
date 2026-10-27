# Zecori Milestone 09A — Review Ready

Status: `09A_REVIEW_READY`
Date: 2026-10-26
Branch: `feat/milestone-08a-consumer-privy`
Reviewed base revision: `121472e54a5c37796adfb2b651e29284a94cd1c1`

## Outcome

Zecori now presents its single working Zcash testnet to Base Sepolia route in plain language, preserves the existing security boundaries, and supplies explicit loading, failure, mobile, and planned-feature states. No signing, transfer, allocation, payout, broadcast, deployment, merge, or push was performed.

The pre-change findings are recorded in [the UX audit](./milestone-09a-ux-audit.md).

## CI diagnosis and repair

The three requested Actions runs all passed dependency installation, unit/API tests, disposable PostgreSQL integrations, typecheck, production build, privacy scan, and the security gate. They failed only at the Docker build:

| Run | Trigger / branch | Actual failure |
| --- | --- | --- |
| [40381454388](https://github.com/Alike001/zecori/actions/runs/40381454388) | pull request / feature branch | `VCS_REF must be the exact 40-character Git revision` |
| [40381407411](https://github.com/Alike001/zecori/actions/runs/40381407411) | push / feature branch | `VCS_REF must be the exact 40-character Git revision` |
| [40381359705](https://github.com/Alike001/zecori/actions/runs/40381359705) | push / `main` | `VCS_REF must be the exact 40-character Git revision` |

Root cause: the Dockerfile intentionally validates `VCS_REF`, but the workflow used `github.sha` only as the image tag and never supplied the build argument. The workflow now calls `docker build --build-arg VCS_REF=${{ github.sha }}`. The provenance check remains enabled and unchanged.

Local reproduction without the argument failed at Dockerfile line 6. The corrected full runtime image build passed; inspection reports revision `121472e54a5c37796adfb2b651e29284a94cd1c1` and non-root user `10001:10001`.

Updated hosted run results are not available because this review intentionally did not push or rerun an old revision.

## Experience delivered

- A distinctive ink, ivory, and Zcash-gold visual system with a split-route vector mark and reduced-motion fallback.
- A five-second landing explanation, honest fixed-route terms, judge walkthrough, working guided preview, safety/privacy explanation, and gated roadmap.
- Plain-language route, wallet, destination, and review copy without removing custody, privacy, network, verification, or consent disclosures.
- Compact mobile product navigation and a readable current-step summary instead of overflowing navigation and journey rails.
- Explicit application loading/error notices plus assistant thinking and error states.
- Activity rows no longer masquerade as links to the homepage; guest and empty states provide relevant next actions.
- Existing passkey, external Zcash wallet, manual/connected Base recipient, exact destination binding, private receipt, order ownership, and settlement boundaries remain intact.

## Working interaction evidence

The browser journey verifies guest exploration; interactive preview; honest roadmap; mobile navigation; route-to-account boundary; read-only wallet checks; invalid recipient handling; wrong-network recovery; fixed-price, custody, and privacy disclosures; Arabic RTL and French docs; reduced motion; voice consent/refusal/correction; no voice auto-submit; owner isolation; and rejection of premature payment instructions.

The real WebAuthn browser smoke also verifies two passkeys, logout/session revocation, cross-session private history, and blocking an unverified destination from payment instructions.

## Screenshots

| View | Before | After |
| --- | --- | --- |
| Landing desktop, 1440×1100 | [PNG](../artifacts/milestone-09a/before/landing-desktop.png) | [PNG](../artifacts/milestone-09a/after/landing-desktop.png) |
| Landing mobile, 390×844 | [PNG](../artifacts/milestone-09a/before/landing-mobile.png) | [PNG](../artifacts/milestone-09a/after/landing-mobile.png) |
| Route desktop, 1440×1100 | [PNG](../artifacts/milestone-09a/before/route-desktop.png) | [PNG](../artifacts/milestone-09a/after/route-desktop.png) |
| Route mobile, 390×844 | [PNG](../artifacts/milestone-09a/before/route-mobile.png) | [PNG](../artifacts/milestone-09a/after/route-mobile.png) |

The before route captures expose a real audit issue: a static Vite preview has no `/api/v1` backend and can remain blank during bootstrap. The after route captures use the disposable in-memory application harness.

## Verification evidence

| Check | Result |
| --- | --- |
| `pnpm test` with disposable PostgreSQL | PASS — 174 tests, 172 passed, 2 intentional live skips, 0 failed; security gate passed |
| `pnpm test:postgres` on a fresh disposable database | PASS — 9/9 |
| `pnpm smoke:passkey -- http://localhost:18789` | PASS — real virtual-authenticator journey |
| `pnpm test:browser` | PASS — `MILESTONE_09A_BROWSER_UX_SECURITY_SMOKE_PASSED` |
| `pnpm test:a11y` | PASS — journey, semantics, RTL, reduced-motion, mobile checks |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS |
| `pnpm privacy:scan` | PASS |
| `pnpm security:gate` | PASS |
| Corrected full Docker build | PASS — revision label and non-root user verified |
| `git diff --check` | PASS |
| `pnpm audit --prod --audit-level high` | NOT VERIFIED — npm registry audit endpoint timed out |

The production build still reports the existing large Privy chunk warning (approximately 1.58 MB); Privy remains optional and disabled by default.

## Changed files

- `.github/workflows/ci.yml` — supplies the validated image revision.
- `package.json` — serializes shared-database integration files to remove cross-file fixture races.
- `src/App.tsx`, `src/ProductSurfaces.tsx`, `src/styles.css` — landing, product flow, state, responsive, accessibility, and design-system refinement.
- `public/favicon.svg`, `index.html`, `README.md`, `docs/zecori-brand-guidelines.md`, `src/lib/docs-content.ts` — coherent brand promise and metadata.
- `scripts/milestone-06a-browser-smoke.mjs`, `scripts/passkey-browser-smoke.mjs` — milestone journey assertions, captures, and rate-limit-safe WebAuthn polling.
- `docs/milestone-09a-ux-audit.md`, `.thoughts/research/2026-10-26-milestone-09a-reality.md`, `.thoughts/verification/2026-10-26-milestone-09a.md` — audit and verification evidence.
- `artifacts/milestone-09a/` — before/after desktop and mobile captures.

## Still disabled or unverified

- Privy is feature-flagged, disables embedded-wallet creation, and was not exercised against a live Privy tenant.
- Live Zcash/Base RPC settlement, funded wallets, provider liquidity, Groq, microphone hardware quality, and durable staging were not exercised.
- Handle payments, private contacts, event-backed notifications, provider comparisons, and expanded voice/languages are displayed only as planned or gated.
- No market quote, provider availability, payment address, settlement success, or refund guarantee is fabricated.

## Safe local preview

UI-only preview:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm preview
```

The static preview can show the public website, but application routes require `/api/v1`. For a disposable end-to-end application preview with fresh screenshots:

```sh
ZECORI_SCREENSHOT_DIR=artifacts/milestone-09a/after pnpm test:browser
```
