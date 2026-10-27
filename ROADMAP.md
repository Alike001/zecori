# Zecori roadmap and evidence status

Updated: 2026-10-27. **Implemented** means code exists, **locally tested** means automated or isolated local evidence passed, and **live verified** means the final hosted or chain environment was exercised. Anything awaiting live verification or blocked must not be advertised as available.

## Implemented and locally tested

- Responsive public route explorer, documentation, mobile layout, English, French, and Arabic RTL rendering. French and Arabic security copy remains labelled as awaiting human review.
- One-process static frontend and `/api/v1` Node server with liveness/readiness endpoints, guarded startup, production HTTPS policy, and external TLS PostgreSQL support.
- Passkey registration and login, multiple credentials, session rotation/revocation, account isolation, owner-scoped history with request-specific recovery, and authorized private receipts.
- Optional handles, exact-match opt-in discovery, encrypted contacts, non-paying request intents, and the durable owner-scoped inbox.
- Redacted shareable receipts that omit source and destination transaction correlation, amounts, addresses, order identifiers, and settlement timestamps.
- The fixed Zcash testnet Ironwood to Base Sepolia test-USDC lifecycle: exact terms, destination-control authorization, fresh receiver allocation, strict source verification, separate payout approval, destination verification, recovery states, and duplicate-settlement protection. All financial gates remain disabled by default.
- Limited typed assistant fallback and voice safety boundaries. Neither has order, wallet, signing, payout, or broadcast authority.

## Implemented but awaiting live verification

- Render plus Neon deployment configuration and the final `zecori.iamalikex.tech` HTTPS origin.
- Physical passkey registration/login, two-profile isolation, cookies, mobile browsers, and final-domain WebAuthn relying-party behavior.
- EIP-712 EOA and ERC-1271 destination-control checks against final hosted RPC configuration.
- Zcash shielded-source verification through the signed private relay and Base Sepolia destination verification for a newly authorized linked order.
- Provider-backed AI, microphone transcription, and speech output. These remain feature-gated and must not be described as live integrations.

## Blocked by external infrastructure or authorization

- An executable Zcash-to-Base route requires a persistent private verifier host, a synchronized Zcash testnet backend, separately authorized watch-only UFVK setup, and end-to-end private relay monitoring.
- Settlement additionally requires confirmed test-USDC and gas liquidity, an independently controlled Base payout signer, a manual approval/broadcast procedure, and explicit authorization for every wallet or financial action.
- Backup, restore, monitoring, and an operator recovery procedure must be proven before a live request can publish payment instructions.
- French and Arabic security language needs human review. Privy and paid-provider AI/voice remain disabled unless their separate security and live acceptance gates clear.

## Future multi-chain and multi-token plans

The intended direction is direct, liquidity-backed payouts to additional destination networks and tokens. No additional chain or token is named, executable, or shown as supported until its registry entry, exact terms, recipient proof, chain/contract verifier, liquidity attestation, signer separation, recovery behavior, and independent receipt evidence all pass the same gates as the Base Sepolia test route. Mainnet, live quotes, automatic settlement, and automatic refunds remain out of scope.

## Next release action

After explicit operator approval, create the free Neon judge database, deploy the prepared free Render service, configure `zecori.iamalikex.tech`, and run final-domain passkey and two-profile acceptance. This can produce a public judge application with no laptop dependency while settlement stays disabled.
