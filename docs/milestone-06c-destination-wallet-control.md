# Milestone 06C — cryptographic Base destination control

## Implemented security boundary

An authenticated owner first creates the immutable, encrypted 06B destination intent. Operator visibility and acceptance remain blocked until the same passkey session completes a server-generated wallet-control challenge. The five-minute, single-use challenge binds the owner fingerprint, session fingerprint, intent UUID, exact recipient, Base Sepolia chain `84532`, exact application origin, a destination-control-only purpose, a random 32-byte nonce, and issued/expiry times.

EOA proofs use EIP-712 and independent server-side signer recovery. Deployed smart-contract recipients use ERC-1271 `isValidSignature(bytes32,bytes)` through the configured trusted Base Sepolia RPC at a recorded block. RPC uncertainty, a changed signer, a rejected wallet request, expiry, replay, account switching, network switching, disconnects, recipient substitution, and owner/session mismatch all fail closed.

The signature authorizes only control of one destination intent. It is not a Zcash source-payment signature, a payout approval, a transaction signature, or spending authority.

## Persistence and settlement checks

Migration `008_destination_wallet_control.sql` adds encrypted challenges and proof envelopes, non-reversible recipient/signature/digest fingerprints, verification state, challenge consumption, pinned block metadata, and append-only audit events. Raw recipients, typed data, and nonces are not stored in plaintext proof tables or audit details. Raw signatures are retained only inside encrypted ERC-1271 proof envelopes because checkpoint revalidation requires them; EOA signatures are discarded after recovery and only their non-reversible fingerprint remains.

Operator listing and acceptance require a `VERIFIED` proof. The proof digest and verification method are committed into the immutable operator manifest. ERC-1271 proofs are rechecked against current Base Sepolia state at operator acceptance and again before payout authorization; an unavailable or invalid recheck blocks progress. EOA proofs are cryptographically immutable and are not RPC-rechecked.

Manual recipient entry remains available for exploration and local address validation. It is labeled unverified and cannot reach operator acceptance without the explicit wallet permission and signing ceremony.

## Supported and unsupported wallets

Supported:

- EIP-1193 wallets that expose the exact destination account and implement `eth_signTypedData_v4` for EIP-712.
- Deployed ERC-1271 wallets on Base Sepolia whose provider can produce the wallet-specific signature and whose `isValidSignature(bytes32,bytes)` returns `0x1626ba7e` at verification checkpoints.

Not currently supported:

- Counterfactual or undeployed smart accounts, including ERC-6492-wrapped signatures.
- ERC-1271 variants that only implement the legacy `isValidSignature(bytes,bytes)` overload.
- Wallets that cannot expose the exact destination account through EIP-1193 or cannot sign EIP-712 v4 data.
- Multichain/cross-chain signature schemes, session-key proofs, delegated signers without ERC-1271 validation, and hardware-wallet firmware that rejects this typed-data shape.

No fallback to personal-sign, EIP-191, a configured recipient, or an operator assertion is allowed.

## Operational note

`BASE_SEPOLIA_RPC_URL` is mandatory for the API and operator checkpoint process. It must be a trusted HTTPS endpoint without embedded credentials. Migration 008 must be reviewed and rehearsed only against disposable PostgreSQL before any durable staging application.
