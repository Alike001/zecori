# Production Zcash verifier architecture

## Exact 0.9.0-rc2 compatibility finding (reviewed 2026-10-24)

The pinned wallet is the independent [`zecrocks/zecd`](https://github.com/zecrocks/zecd) project, not `zcashd` or Zallet. Those products' import limitations do not describe zecd.

Local artifact evidence:

- Binary: `../../experiments/shielded-receiver/zecd-nu7/zecd-0.9.0-rc2-linux-amd64/zecd`.
- `zecd --version`: exactly `zecd 0.9.0-rc2`.
- Archive SHA-256: `fcfd29e0c5bf0f946fc684ad642560db653526265111f359a682fcc1cfde1474`.
- The hash equals the local `SHA256SUMS`, local `tarball.sha`, and GitHub release asset digest. The release asset size is `67,440,897` bytes.
- Git tag `v0.9.0-rc2` resolves to commit `56e809fb4a3abf122505a28163321149a8823413`. It is a lightweight, unsigned tag, so provenance is verified to the GitHub-hosted release digest but not to a maintainer signature.

Exact release findings:

| Capability | Finding | Evidence |
| --- | --- | --- |
| `export-ufvk` | Supported. Reads the wallet DB read-only, needs no identity/passphrase, and works for a locked wallet. | Local `--help` / `export-ufvk --help`; [watch-only guide](https://zecd.org/guide/watch-only.html#exporting-the-key-zecd-export-ufvk); tagged `src/init.rs`. |
| `init --ufvk` | Supported. Creates a seedless watch-only wallet; conflicts with restore/encryption and requires a backend/birthday setup. | Local `init --help`; [watch-only guide](https://zecd.org/guide/watch-only.html#creating-the-watch-only-wallet-zecd-init-ufvk); tagged CLI tests. |
| Locked-wallet UFVK export | Supported without unlocking or reading spending material. | Guide and tagged `export_ufvk_string`, which reads the stored account UFVK. |
| Watch-only Ironwood incoming verification | Supported. Ironwood notes use the Orchard receiver/key, are scanned into a distinct Ironwood pool, and history reports `pool: "ironwood"`, amount, output index, confirmations, block identity and diversifier. | Release README/changelog, example config, and tagged Ironwood read/scanner tests. This milestone verified code/help only; it did not initialize a watch wallet or run a new live receive. |
| `private_keys_enabled = false` | Supported and is the authoritative wallet-level watch-only signal. `unlocked_until` is absent for watch-only. | [RPC semantics](https://zecd.org/guide/watch-only.html#rpc-semantics) and [getwalletinfo reference](https://zecd.org/rpc/wallet-addresses.html#getwalletinfo). |
| Existing address/diversifier ownership | Supported. `getaddressinfo.ismine` is cryptographic for shielded addresses, `diversifier_index` is returned for owned addresses, and `receivers_consistent` rejects mixed-index UAs. | [getaddressinfo reference](https://zecd.org/rpc/wallet-addresses.html#getaddressinfo) and tagged `wallet/read.rs` ownership code/tests. |

No UFVK was exported, no watch-only wallet was initialized, no existing wallet was opened or altered, and no address was derived during this audit.

## Safe deployment boundary

1. The public API and PostgreSQL run on the production VPS. Neither receives wallet material or direct wallet RPC access.
2. Base verification may run in the isolated verifier network because all Base facts are public. Its bearer token remains a separate secret and it has no public port.
3. Zcash source verification runs on a private operator-controlled host with loopback-only RPC, a locked wallet, restrictive firewall rules, and no inbound Internet listener. For the current verifier this may be the existing Wallet B host; its data directory never leaves that host.
4. The durable private relay uses separately provisioned Ed25519 coordinator and verifier identities. PostgreSQL stores encrypted challenges and responses, unique nonces/signature fingerprints, short expiry windows, leases and attempt counts. The operator verifier pulls outbound over an approved mutually authenticated tunnel, verifies the coordinator signature, queries loopback-only zecd, and returns a verifier signature. A lost connection causes lease-based redelivery; it never invents success.
5. A later, separately approved ceremony may build a fresh watch-only wallet from an operator-mediated one-time import. Verify the pinned binary digest, confirm network/RPC schema, start at a conservative birthday, wait for complete history enhancement, and test known incoming and non-matching transactions. Never export a UFVK through logs, shell history, process arguments, support tickets, or deployment automation.
6. Bind wallet RPC to loopback or a Unix socket, use cookie authentication, run as a dedicated unprivileged user, deny outbound access except the required full-node/backend path, and keep the wallet database and backups encrypted. The viewing key remains sensitive financial metadata even though it cannot spend.

## Promotion gate

The compatibility gate is now satisfied at documentation, binary-help and tagged-source level. Promotion remains blocked until the operator explicitly approves the one-time UFVK ceremony, the fresh watch-only instance completes its scan, a known incoming Ironwood receive and a non-match are checked read-only, relay mTLS/tunnel identities are provisioned, and relay restart/reorg recovery is exercised against that instance. Spending seeds are never an acceptable substitute.

## Attestation trust boundary

The relay proves that a registered operator verifier signed a statement and that the coordinator applied the statement to the same immutable order. It is not public cryptographic proof of a shielded Zcash payment. The verifier can be wrong or compromised, and public observers cannot reconstruct the shielded linkage. Therefore private evidence remains encrypted and owner-only, public receipts stay redacted, and any stale, ambiguous, unavailable or reorg-affected check remains `UNRESOLVED`.
