# Project Quality Profile

## Stack

Node 24.14.x, pnpm 10.33.4, TypeScript 5.9, React 19, Vite 7, MDX, Node HTTP server, PostgreSQL 17, Docker/Render, and Neon.

## Quality Gates

- Format: no dedicated formatter script; preserve existing style and review diffs.
- Static analysis: `corepack pnpm typecheck`.
- Unit/API: `corepack pnpm test`.
- PostgreSQL: disposable PostgreSQL 17 plus `POSTGRES_TEST_URL=... corepack pnpm test:postgres`.
- Browser/mobile/accessibility: `corepack pnpm test:browser`.
- Contrast: `corepack pnpm test:contrast`.
- Privacy/security: `corepack pnpm privacy:scan` and `corepack pnpm security:gate`.
- Docs/build: `corepack pnpm docs:validate` and `corepack pnpm build`.
- Dependencies: full and `--prod` pnpm audits, with disabled/dev-only findings distinguished from production.
- Hosted demo: `corepack pnpm smoke:judge https://zecori.iamalikex.tech`.
- Release: `corepack pnpm preflight`; a block is expected off clean main or without dedicated-production secrets.

## File Length Guardrail

Target 200 source lines, warn above 200, and justify above 300. Existing large lifecycle/UI files are legacy exceptions. New quote logic is isolated instead of enlarging the fixed-route store or UI.

## Commit Policy

Focused local commits only for this sprint. No push, deploy, migration, flags, providers, wallets, or financial actions. Preserve unrelated and untracked user work.

## AGENTS.md Notes

No repository AGENTS.md exists. The user-supplied Context7 instruction was followed for Render/Neon platform documentation.

## Open Questions

- No lint/format script exists.
- CI results for the new local commit cannot exist without a push.
- Browser coverage is fixture-based; physical-device and two-profile hosted acceptance remain separate.
