# Zecori Milestone 09C — review ready

Status: `09C_REVIEW_READY`

Date: 2026-10-27
Branch: `feat/milestone-08a-consumer-privy`
Reviewed HEAD provenance: `121472e54a5c37796adfb2b651e29284a94cd1c1`
PR: [#1](https://github.com/Alike001/zecori/pull/1)

No commit, push, merge, deployment, wallet access, signing, address allocation, funding, payout, or broadcast was performed.

## Working result

### Handles and private contacts

- Optional account handle with case-insensitive uniqueness, reserved-name checks, ASCII/confusable defense, typed claim/rename confirmation, fresh-auth requirement, optimistic versioning, 30-day rename cooldown, and 90-day prior-name quarantine.
- Exact-match availability and discovery only. Reserved and claimed names receive the same public result; persistent candidate records are SHA-256 fingerprints, not plaintext.
- Discoverability is off by default and changes only through explicit authenticated opt-in/out.
- Contact labels are encrypted with the existing versioned application envelope and lists are owner-scoped.
- Fixed-route request intents require a saved opted-in contact and a second explicit confirmation. Accept/decline state is durable.
- An intent does not create an order, publish or replace a destination, reserve liquidity, allocate an address, authorize payment, or grant wallet authority.

### Transactional inbox

- Order/account mutations produce redacted PostgreSQL outbox rows in the same transaction.
- A leased `FOR UPDATE SKIP LOCKED` dispatcher creates idempotent owner-scoped inbox items and append-only delivery attempts; expired leases safely replay after restart.
- Read/unread, mark-all-read, category filters, loading/error/empty/sign-in states, and a live unread bell are implemented.
- Final-success wording comes only from an independently inserted receipt. Detection, confirmation, submitted, failed, unresolved, refund-pending, refunded, expired, and cancelled states remain distinct.
- Outbox constraints and dispatcher validation reject addresses, recipients, signatures, transaction hashes, transaction IDs, and emails. External alerts remain disabled.

### AI, voice, and languages

- The existing deterministic assistant, Groq adapter, typed cards, injection defenses, account authorization, provider timeouts/rate limits/malformed-output fallback, and no-authority contract remain intact.
- Voice remains explicit-consent only, authenticated, bounded to 30 seconds/2 MB, memory-only, visually reviewed, and never auto-submitted or accepted as financial confirmation.
- English, French, and Arabic now cover product navigation plus handle, inbox, assistant, order-state, error, and inbox-event surfaces. Arabic product/docs pages use RTL. Fixed identifiers (`TAZ`, `USDC`, route IDs, chain IDs, addresses, transaction hashes) are not translated.
- French and Arabic security copy is still marked pending human review.

## 09C files changed

- Data/service: `server/migrations/010_handles_contacts_inbox.sql`, `server/user-features.ts`, `server/user-auth.ts`, `server/public-api.ts`, `server/app-server.ts`
- API and UI: `src/lib/order-api.ts`, `src/lib/product-capabilities.ts`, `src/lib/i18n.ts`, `src/App.tsx`, `src/ProductSurfaces.tsx`, `src/styles.css`
- Tests/journeys: `server/user-features.test.ts`, `server/user-features.integration.test.ts`, `server/app-server.test.ts`, `src/lib/i18n.test.ts`, `src/lib/product-capabilities.test.ts`, `scripts/milestone-06a-browser-smoke.mjs`, `package.json`
- MDX/manual: `src/docs/pages/handles-contacts.mdx`, `src/docs/pages/inbox-notifications.mdx`, `src/docs/pages/ai-and-voice.mdx`, `src/docs/pages/api-architecture.mdx`, `src/docs/pages/privacy-custody.mdx`, `src/docs/pages/security.mdx`, `src/docs/pages/roadmap.mdx`, `src/docs/pages/judge-walkthrough.mdx`, `src/docs/registry.ts`, `scripts/validate-docs.mjs`
- Product truth/review: `README.md`, `docs/handles-and-contacts-plan.md`, `docs/notifications-plan.md`, `docs/milestone-09c-review-ready.md`, `.thoughts/research/2026-10-27-milestone-09c-reality.md`, `.thoughts/verification/2026-10-27-milestone-09c.md`
- Evidence: `artifacts/milestone-09c/after/*.png`

All pre-existing 09A/09B modified and untracked files remain present. The complete `git status` must be reviewed because several shared frontend/config files contain cumulative milestone work.

## Migration and API surface

Migration `010_handles_contacts_inbox.sql` adds:

- `account_handles`, `reserved_handles`, `handle_history`, and `handle_lookup_attempts`
- `private_contacts` and `handle_request_intents`
- `transactional_outbox`, `inbox_items`, and `notification_delivery_attempts`
- redacted order-state and receipt triggers

New authenticated APIs:

- `GET /api/v1/account/handle`
- `POST /api/v1/handles/availability`
- `PUT /api/v1/account/handle`
- `PATCH /api/v1/account/handle/discoverability`
- `GET|POST /api/v1/contacts`, `DELETE /api/v1/contacts/:id`
- `GET|POST /api/v1/handle-requests`, `POST /api/v1/handle-requests/:id/respond`
- `GET /api/v1/inbox`, `GET /api/v1/inbox/unread-count`
- `POST /api/v1/inbox/:id/read`, `/unread`, and `/api/v1/inbox/read-all`

## MDX documentation routes

- `/docs/handles-contacts`
- `/docs/inbox-notifications`
- `/docs/ai-and-voice`
- `/docs/api-architecture`
- `/docs/privacy-custody`
- `/docs/security`
- `/docs/roadmap`
- `/docs/judge-walkthrough`
- all earlier user, route, wallet, Noir, receipt, recovery, evidence, and brand pages remain registered

## Screenshots

Desktop and mobile production-build captures are under [`artifacts/milestone-09c/after`](../artifacts/milestone-09c/after):

- `landing-desktop.png`, `landing-mobile.png`
- `route-desktop.png`, `route-mobile.png`
- `account-handles-desktop.png`, `account-handles-mobile.png`
- `inbox-desktop.png`, `inbox-mobile.png`
- `docs-desktop.png`, `docs-mobile.png`

## Verification evidence

| Check | Result | Evidence type |
|---|---|---|
| Full unit/API/integration suite | PASS — 182 total, 180 pass, 2 gated live-chain skips, 0 fail | automated + disposable PostgreSQL |
| PostgreSQL serial integration | PASS — 11/11 | actual PostgreSQL 17 disposable database |
| WebAuthn browser acceptance | PASS — two virtual passkeys, rotation/logout/relogin, private history | Chromium virtual authenticator |
| 09C browser journey | PASS | production build + fixture identity/providers |
| Accessibility/RTL/reduced motion | PASS | Chromium assertions |
| MDX route/link validation | PASS — 17 pages, 13 required routes | build-time validation |
| TypeScript | PASS | `tsc -b` |
| Production build | PASS | Vite build; known Privy annotation/chunk-size warnings remain |
| Privacy scan | PASS | repository/frontend scan |
| Read-only security gate | PASS | no public financial execution method |
| Docker CI build/provenance | PASS | exact 40-character OCI revision label |
| Dependency audit | BLOCKED — 5 findings: 2 high, 3 moderate | current registry audit |
| Live Groq/recognition/TTS | NOT RUN | requires separate explicit approval and credentials |
| Noir Wallet live extension | NOT RUN | requires isolated checksum-verified profile and explicit acceptance |
| Live Zcash/Base/funded settlement | NOT RUN / NO-GO | prohibited in this milestone |

The audit findings are in disabled Privy transitive paths: vulnerable Zod copies (high), plus `uuid` and `decode-uri-component` findings (moderate). Privy remains disabled; no unsupported Zod 4 or broad dependency override was applied. This containment does not count as remediation.

## Remote CI state

PR #1 still points to the unchanged remote head `121472e54a5c37796adfb2b651e29284a94cd1c1`. Historical validation runs [40381454388](https://github.com/Alike001/zecori/actions/runs/40381454388) and [40381407411](https://github.com/Alike001/zecori/actions/runs/40381407411) remain failed because no local work was pushed. The workflow now supplies `--build-arg VCS_REF=${{ github.sha }}`; the local CI-equivalent image accepted and preserved the exact 40-character revision. Updated GitHub results cannot exist until an approved push triggers them.

## Mainnet and live-chain blockers

- No mainnet route/token/provider registry entry or production liquidity acceptance.
- No funded end-to-end shielded Zcash-to-Base evidence or approved recovery drill.
- No approved production secrets, PostgreSQL mTLS identity acceptance, watch-only UFVK ceremony, or independently accepted operator controls.
- Noir v1.0.40 build/network/pool attestation remains unverified in an isolated profile.
- Privy dependency advisories remain unresolved.
- Provider-backed AI/voice and multilingual security copy lack required live/human acceptance.

These are why mainnet, automatic settlement/refunds, payment-by-handle, external alerts, and the first linked swap remain disabled.

## Human acceptance steps

1. Review the typed handle claim/rename copy and confirm unavailable names reveal no owner metadata.
2. With two disposable accounts, opt the recipient into exact discovery, add the contact, initiate the non-paying request, and accept/decline it. Confirm no order or destination appears.
3. Restart the disposable API/database between event creation and inbox reading; confirm one item, stable read state, and owner isolation.
4. Switch English/French/Arabic and inspect desktop/mobile navigation, handle/inbox/assistant screens, RTL focus order, keyboard access, and fixed financial identifiers. Obtain human security-language review before changing support claims.
5. Separately approve credentials before any live Groq/speech check. Review the transcript visually and confirm it never submits automatically.
6. Keep Noir and live-chain acceptance in isolated testnet-only profiles with no existing recovery phrase or wallet data.

## Scoped commit proposal

Because Milestones 09A and 09B are also preserved but uncommitted and share frontend/config files with 09C, the safest reviewable proposal is one integration commit after inspecting the complete staged diff:

`feat: complete zecori consumer ux docs and account messaging`

Do not split shared migration/API/UI files mechanically: that would create intermediate commits that do not build. If the reviewer requires separate history, use interactive patch staging only after creating a backup branch.

## Safe commands for PR #1

Review only:

```bash
cd ~/Desktop/zecathon/product/zecathon-crosschain-app
git status --short
git diff --check
git diff --stat
git diff
git ls-files --others --exclude-standard
```

After explicit approval to commit the complete preserved review stack:

```bash
git switch feat/milestone-08a-consumer-privy
git add --all
git diff --cached --check
git diff --cached --stat
git commit -m "feat: complete zecori consumer ux docs and account messaging"
```

After a second explicit approval to update PR #1:

```bash
git push origin HEAD:feat/milestone-08a-consumer-privy
gh pr checks 1 --watch
```

No force push, merge, deployment, or durable environment command is part of this handoff.
