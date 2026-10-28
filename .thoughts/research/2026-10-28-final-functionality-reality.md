# Reality Research: final functionality and submission state

## Scope

Establish the exact local/GitHub/public-demo state, current official event requirements, pricing/hosting/AI/voice/settlement boundaries, and evidence that can be obtained without paid infrastructure or financial actions.

## Sources Checked

- Local Git refs, logs, diffs, manifests, source, tests, deployment files, and prior `.thoughts` artifacts.
- GitHub CLI/API for `Alike001/zecori` and `main` after `git fetch --prune`.
- Public HTTPS, TLS, DNS, health, and guarded smoke for `zecori.iamalikex.tech`.
- Official live Zecathon page assets `darkpool/data.js`, `auth.js`, and `forms.js` on 2026-10-28.
- Current Render and Neon documentation through Context7.
- Read-only settlement readiness, Base Sepolia RPC, local operator configuration, automated tests, and disposable PostgreSQL.

## Verified Facts

- GitHub is public. `main` is unprotected at `8374687469b701b61c39e8495cf783ab1d9f316b`.
- The starting branch commit was `b9264321769315ec20632d7d136ec7f48fb37d83`, three commits ahead of main and one ahead of its remote. The pre-sprint tracked state and `.thoughts` were backed up locally.
- The public demo has valid HTTPS and returns live/ready 200. Guarded smoke reports route requests disabled. DNS is a CNAME to Render; the domain/DNS provider supplies no application compute.
- No Render credential is present. Exact deployed SHA, dashboard variables, deploy logs, and Neon console state are not independently visible.
- Official public data lists Cross-Chain as reaching another chain without unshielding in transit; criteria are privacy, usefulness, execution, and originality. The form requires name, one track, <=2,000-character description, public repo, working demo, two-minute video, and public-repo confirmation. Deadline is 2026-10-28 23:59 UTC.
- The fixed product route remains exactly 1,000,000 zatoshis to 1,000,000 test-USDC atomic units and is not a market quote.
- Deterministic Help and mock Groq/speech boundaries pass. No live provider or physical microphone test ran.
- Read-only settlement readiness passed source reference, Base identity/token, operator account binding, and payout liquidity; it blocked on live source funding, persistent watch-only zecd, Noir artifact, and an initially absent test database URL.
- A later disposable PostgreSQL run passed 11/11 integration tests. It was stopped and removed.
- Full local tests passed with live-chain/integration skips recorded separately. Browser/mobile/accessibility, contrast, privacy/security, docs, build, live smoke, and production-only dependency audit passed.
- No Zcash address was allocated, no wallet was opened/unlocked/imported, no signature or broadcast was requested, no payout ran, and no live receipt exists.

## Inferences

- Public behavior is consistent with the checked-in closed-route contract, but it cannot attest which exact commit Render is running.
- The current same-origin design has a smaller passkey/cookie/CORS security surface than a pre-submission static/API split.
- The repository demonstrates genuine interoperability invariants in code and integration tests, but not an actual linked cross-chain transfer.

## Unknowns And Questions

- Exact Render deployed SHA and dashboard configuration; current Neon console/migration/backup state beyond prior recorded evidence.
- Authenticated entrant/team eligibility and final form state.
- Uploaded video URL and anonymous playback.
- Persistent private verifier host eligibility/capacity, UFVK ceremony, backup/restore, and restart evidence.
- Real source and destination transaction identifiers and a live authenticated receipt.

## Not Included

No push, deployment, DNS change, production migration, route flag, credential activation, microphone capture, wallet key import, signature, broadcast, payment, or form submission.
