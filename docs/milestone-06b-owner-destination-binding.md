# Milestone 06B: owner-specific Base destination binding

## Implemented guarantee

A passkey-authenticated user explicitly confirms one complete Base Sepolia recipient for the fixed 0.01 TAZ → 1 test-USDC route. The server validates chain `84532`, the official test-USDC contract, the non-zero 20-byte recipient, and EIP-55 when the input is mixed case. The recipient is normalized and stored only inside a versioned AES-256-GCM envelope.

The durable record binds the authenticated user UUID and hash, request and intent UUIDs, route, source privacy pool, source and destination amounts, destination network and token, consent version and digest, confirmation time, and expiry. Acceptance decrypts this record transactionally and creates a version-2 immutable operator manifest. The operator command has no recipient option or configured fallback.

Acceptance still does not allocate or publish a Zcash receiver. Payment instructions require the separate authorization, crash-safe derivation journal, independent availability validation, reservation, and publication stages already enforced by the settlement store.

## Authentication is not wallet-control proof

Passkey authentication proves access to the Zecathon account. `eth_accounts` only reports an address already exposed by a browser provider. Neither establishes control of the Base address. The stored value is therefore explicitly `NOT_PERFORMED`, and the public API reports `walletControlVerified: false`.

A later milestone should add a separate challenge with expiry and replay protection:

- EOAs: verify a domain-separated EIP-191 or typed-data signature over the exact intent digest, chain ID, origin, nonce, and expiry.
- Contract wallets: verify the same intent through EIP-1271 against Base Sepolia at a pinned block, with explicit counterfactual-account policy if ever supported.
- Persist verification evidence separately from passkey consent; never upgrade an existing intent silently. Require a new consent/version when verification semantics change.

No signature request, transaction signing, broadcast, funded request, or automated payout is part of 06B.

## Migration 007

`007_owner_destination_binding.sql` keeps legacy recipient rows identifiable as binding version 1 and makes new version-2 rows owner-scoped with no plaintext recipient. `destination_intents` stores encrypted evidence plus non-reversible fingerprints and fixed public route facts. Immutable guards reject destination or consent substitution; an append-only event table records confirmation and binding without addresses. New acceptance and payment allocation reject legacy or incomplete bindings.

Do not apply this migration to durable staging until the change set and a backup/restore rehearsal have been reviewed.
