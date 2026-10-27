# Zecori — Zecathon submission packet

Status: draft evidence packet. It is not a submitted entry and does not claim eligibility or rule compliance. No authenticated Cross-Chain rules artifact or submission receipt is present locally.

## Official requirements checked

Checked 2026-10-26 against the official event site and its live published submission form:

- Event: [Zecathon](https://thezecathon.com/)
- Deadline: 2026-10-28 at 23:59 UTC.
- Track: exactly one; **Cross-Chain**.
- Public/open-source repository required by the deadline.
- Submission fields: project name, one track, description (maximum 2,000 characters), repository URL, working demo URL, two-minute demo video URL, and confirmation that the repository will be public.
- Judging criteria: privacy, usefulness, execution, and originality. Privacy leaks are described as disqualifying.
- One submission per account/team; code must be written during the build window; libraries are allowed; submissions remain sealed until judging opens.

The authenticated submission must still be completed by the registered human account. A public repository, reachable demo URL, video URL, and final form submission have not been verified in this review.

## Submission copy

### Project name

Zecori

### Tagline

Your Zcash. More possibilities.

### Problem

Cross-chain movement often destroys the privacy benefit a user gained from Zcash: public routing, wallet correlation, opaque custody, and optimistic “success” UI can reveal too much or encourage unsafe payment. Users need an honest way to understand exactly where shielding ends, who holds funds, and what evidence proves settlement.

### Description draft

Zecori is a privacy-first route desk for one deliberately constrained cross-chain test flow: exactly 0.01 TAZ from the Zcash testnet Ironwood shielded pool to exactly 1 test USDC on Base Sepolia (chain 84532). Users can inspect the route before signing in, prove control of the transparent destination with a purpose-limited EIP-712 signature, and follow backend-owned lifecycle evidence in a private passkey account.

Zecori does not pretend to be a trustless bridge. An experimental trusted liquidity provider temporarily custodies test funds; payout requires separate operator approval and independent source/destination checks. No browser or AI path can allocate an address, spend from a wallet, sign, broadcast, approve a payout, fabricate a quote, or manufacture a completed receipt. Mainnet, live quotes, automatic settlement/refunds, Privy login, payment by handle, ERC-1271 wallets, external alerts, and settings remain disabled or planned.

The Zcash privacy value is explicit: the source payment stays in the Ironwood shielded pool, public receipts omit shielded source correlation, and private settlement data is owner-scoped and encrypted at rest. The Base Sepolia destination is transparently disclosed as public. Zecori makes that boundary visible instead of marketing cross-chain privacy it cannot provide.

### Unique Zcash privacy value

- Begins with a shielded Ironwood source, rather than asking the user to unshield before routing.
- Keeps source correlation out of public/shareable receipts.
- Separates private account evidence from public route discovery.
- Explains the exact point where destination-chain transparency begins.
- Fails closed: uncertain evidence, wrong networks, replay, cross-account access, or missing approval cannot become a payment instruction or success receipt.

## Architecture

```text
Public React UI
  ├─ canonical route + feature registries
  ├─ passkey / optional-disabled Privy boundary
  └─ advisory deterministic/optional Groq assistant
             │ owner-scoped API + CSRF/origin checks
             ▼
Node public API ── PostgreSQL authority ── append-only audit history
             │                    │
             │                    └─ encrypted private evidence / receipts
             ▼
operator-only controls (not exposed publicly)
  ├─ Zcash Ironwood read-only verification
  ├─ purpose-limited destination-control verification
  └─ Base Sepolia payout evidence verification
```

The public application cannot derive a Zcash address, unlock a wallet, allocate, accept, fund, sign, broadcast, approve a payout, or write settlement success. Those actions remain separate operator-controlled gates.

## Implemented capability inventory

- Public responsive route discovery and fixed-term review. Request creation fails closed by default until the deployment operator explicitly attests current provider/testnet-path readiness.
- Exact route registry: 0.01 TAZ on Zcash testnet Ironwood → 1 test USDC on Base Sepolia 84532.
- Passkey registration, login, additional credentials, revocation, session rotation, and owner isolation.
- Purpose-limited EIP-712 EOA destination-control proof with replay and owner checks.
- PostgreSQL migrations 001–010, immutable manifests, durable allocation structures, encrypted evidence, audit history, lifecycle recovery states, and private/redacted receipts.
- Optional confirmed handles, exact-match opt-in discovery, encrypted owner-only contacts, non-paying request intents, and an owner-scoped in-app inbox driven by a transactional outbox.
- Read-only Zcash/Base checks and independent settlement-verifier boundaries.
- Deterministic assistant route/review/status cards; optional Groq chat/speech adapters remain untested live.
- English, French, and Arabic deterministic guidance with explicit human-review status.
- Responsive dark/light themes, reduced-motion behavior, honest loading/empty/error states, and five-minute judge walkthrough.

## Limitations

- The first linked funded shielded-to-Base settlement has not been approved or performed; the route is presented as implemented but not live, not as a verified successful bridge.
- Real human Privy login is disabled and untested. Its vulnerable React connector graph is compiled out and absent from the production dependency tree/image, but it remains a blocker to re-enablement.
- Live Groq chat, speech model availability/quota, physical microphone behavior, and pronunciation are untested.
- Durable staging has not been migrated or exercised in this milestone. A separate judge Compose stack and smoke runbook are prepared but have not been deployed.
- Payment by handle, ERC-1271 contract wallets, mainnet, live quotes, automatic settlement/refunds, external notifications, email, and settings are disabled or planned.
- Zecori is a provisional brand without trademark or domain clearance.

## Screenshot evidence inventory

| File | Evidence | Status |
|---|---|---|
| `artifacts/milestone-09c/after/landing-desktop.png` | Hero, exact route, custody disclosure | Captured from the local production build |
| `artifacts/milestone-09c/after/landing-mobile.png` | Responsive landing and navigation | Captured from the local production build |
| `artifacts/milestone-09c/after/route-desktop.png` | Exact route and transparent-destination review | Captured from the local production build with fixtures |
| `artifacts/milestone-09c/after/account-handles-desktop.png` | Confirmed optional handle experience | Captured from the local production build with fixtures |
| `artifacts/milestone-09c/after/inbox-desktop.png` | Owner-scoped inbox experience | Captured from the local production build with fixtures |

Do not use fabricated completed-payment screenshots. A receipt screenshot may use a clearly labelled synthetic fixture only.

## Proof inventory

- Commit history preserves the immutable 07A candidate and separate review commits.
- Migration hashes and disposable PostgreSQL execution for 001–010.
- Unit, API, integration, WebAuthn/browser, localization, AI/voice contract, privacy, read-only security, typecheck, and production-build outputs.
- Static staging and production preflight reports, without accessing or migrating staging.
- Dependency audit output with unresolved advisories recorded rather than suppressed.
- Human acceptance still required for login providers, chain reads, and the separately approved first settlement.

## Two-minute demo script

**0:00–0:20 — Problem.** “Cross-chain products often erase Zcash privacy or hide where it ends. Zecori starts from a shielded Ironwood payment and makes the transparent destination boundary explicit.”

**0:20–0:45 — Exact route.** Show the homepage and route registry. “The implemented path is exactly 0.01 TAZ to 1 test USDC on Base Sepolia. This is fixed test data, not a quote. Requests are closed unless this deployment has a current operator readiness attestation.”

**0:45–1:15 — Guarded request.** Open the route. Show read-only checks, passkey boundary, recipient validation, and purpose-limited EIP-712 proof. “The signature proves destination control only. It cannot transfer tokens or authorize payout.”

**1:15–1:40 — Evidence.** Show a disposable fixture lifecycle and branded receipt state. “The browser cannot declare success. A receipt appears only after independent source and destination verification.”

**1:40–2:00 — Honest limits.** Open the truth matrix. “The first funded linked settlement, public judge deployment, Privy, live Groq/voice, mainnet, automatic settlement, and refunds remain gated. The next step is a separately approved human test—not a fictional animation.”

## Roadmap

1. Replace the disabled Privy React graph with an upstream-compatible clean release and complete real human login acceptance before re-enabling it.
2. Validate trusted read-only Zcash and Base endpoints from the reviewed candidate.
3. Complete live Groq/voice provider and multilingual human review, or keep those features disabled.
4. Obtain separate approvals for deployment, migration, wallet access, allocation, funding, acceptance, and payout.
5. Perform and independently verify the first exact shielded testnet settlement, then publish only redacted evidence.
6. Reassess LP trust, refund policy, route expansion, and brand clearance before any mainnet work.
