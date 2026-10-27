# Zecori roadmap and evidence status

Updated: 2026-10-27. Status words are intentionally strict: **implemented** means code exists, **locally tested** means automated/local evidence passed, **live verified** means the final hosted or chain environment was exercised, and **future/blocked** means it must not be advertised as available.

| Surface | Implemented | Locally tested | Live verified | Current status |
| --- | --- | --- | --- | --- |
| Responsive public UI, route catalogue, docs, mobile layout | Yes | Yes | No | Ready to host |
| One-process static UI + `/api/v1` server, liveness/readiness | Yes | Yes | No | Render + Neon config prepared |
| Passkey registration/login, multiple credentials, session rotation/revocation | Yes | Yes, including isolated virtual WebAuthn | No physical passkeys on final domain | Final-domain acceptance required |
| Account isolation, owner-scoped history and recovery | Yes | Yes | No | Final hosted two-profile check required |
| Handles, exact opt-in discovery, encrypted contacts, non-paying requests | Yes | Yes | No | Experimental judge feature |
| Durable owner-scoped inbox and transactional outbox | Yes | Yes | No | Experimental judge feature |
| Redacted/shareable and authorized private receipts | Yes | Yes | No new linked settlement | Privacy gates preserved |
| English, French and Arabic/RTL | Yes | Yes | No human review for French/Arabic security copy | Experimental localization |
| Fixed Zcash testnet Ironwood -> Base Sepolia test-USDC route logic | Yes | Yes with fixtures | No linked live order | Disabled |
| Destination EIP-712 EOA control verification | Yes | Yes | No final hosted wallet acceptance | Request route remains disabled |
| ERC-1271 destination verification | Yes | Yes | No live contract-wallet acceptance | Disabled |
| Zcash shielded-source verification and signed private relay | Yes | Yes with fixtures | No hosted watch-only verifier | Blocked |
| Base Sepolia receipt verification | Yes | Yes with fixtures | Historical reference only | Not settlement-ready |
| Operator liquidity, source payment, payout signing/broadcast | Deliberately absent from public app | Safety boundaries tested | No | Blocked; separate authorization required |
| Privy, provider AI, speech, Noir wallet | Feature-gated code or probes | Partial/local only | No | Disabled |
| Mainnet and unsupported destinations | No | Policy rejection tested | No | Future; remain disabled |

## Immediate release milestone

Commit and publish the reviewed deployment changes only after operator approval; create a new Neon judge project; deploy the single free Render web service; configure `zecori.iamalikex.tech`; and perform final-domain passkey/two-profile hosted acceptance. This produces a genuine public judge application with no laptop dependency, while financial execution remains disabled.

## Live-settlement blockers

The first executable order is blocked on a persistent student-credit verifier VM, synced Zebra testnet backend, separately authorized watch-only UFVK ceremony, live Ironwood receive/non-match evidence, end-to-end private relay transport, confirmed test-USDC/gas liquidity, an independently controlled Base payout signer and manual broadcast procedure, hosted backup/restore and monitoring, plus explicit authorization for every wallet or financial action.
