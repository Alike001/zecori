# Production Zcash verifier architecture

## Compatibility finding (reviewed 2026-10-24)

No official Zcash project or release named `zecd 0.9.0-rc2` could be identified in the Zcash or Zcash Foundation release records. It must not be treated as a compatible production target without an exact upstream repository, signed artifact, and RPC transcript.

The closest official components have materially different versions and limits:

- `zcashd` is deprecated and its final 6.20.0 release reached its end-of-support halt in July 2026. Its documented `z_importviewingkey` does not import Unified viewing keys.
- Zallet is the beta replacement wallet. The current published beta documents export of Unified full/incoming viewing keys, but its documented `z_importviewingkey` imports Sapling extended full viewing keys only. That does not satisfy this application's Orchard/Ironwood watch-only requirement.
- Zebra is the full-node backend, not a wallet that can independently hold and scan this application's UFVK through the existing wallet RPC contract.

Therefore this milestone does not implement a version-specific UFVK import or place any spending seed, wallet database, mnemonic, viewing key, or RPC cookie on a public VPS.

Primary references: [zcashd viewing-key RPC](https://zcash.github.io/rpc/z_importviewingkey.html), [zcashd support/EOL policy](https://github.com/zcash/zcash/blob/master/doc/book/src/user/release-support.md), [Zallet RPC compatibility](https://github.com/zcash/zallet/blob/main/book/src/zcashd/json_rpc.md), and [Zallet releases](https://github.com/zcash/zallet/releases).

## Safe deployment boundary

1. The public API and PostgreSQL run on the production VPS. Neither receives wallet material or direct wallet RPC access.
2. Base verification may run in the isolated verifier network because all Base facts are public. Its bearer token remains a separate secret and it has no public port.
3. Zcash source verification runs on a private operator-controlled host with loopback-only RPC, a locked wallet, restrictive firewall rules, and no inbound Internet listener. For the current verifier this may be the existing Wallet B host; its data directory never leaves that host.
4. A queue/relay may pull an order-scoped verification job outbound from the production service and return only signed, minimum-necessary evidence. Jobs contain the expected transaction ID, receiver binding, amount, pool, allocation height/time, and confirmation policy. Returned evidence is revalidated and encrypted before PostgreSQL commit.
5. When an official wallet release supports Orchard/Ironwood UFVK import, build a fresh watch-only wallet from an operator-mediated one-time import. Verify signed binaries, confirm the exact network and RPC schema, start scanning from a conservative birthday, wait for complete history enhancement, and test known incoming and non-matching transactions. Never export the UFVK through logs, shell history, process arguments, support tickets, or deployment automation.
6. Bind wallet RPC to loopback or a Unix socket, use cookie authentication, run as a dedicated unprivileged user, deny outbound access except the required full-node/backend path, and keep the wallet database and backups encrypted. The viewing key remains sensitive financial metadata even though it cannot spend.

## Promotion gate

Production source verification remains blocked until an exact supported release can import and scan the needed Orchard/Ironwood viewing capability, its RPC behavior passes the existing verifier tests, reorg and restart recovery are exercised, key backup/restore is proven, and the operator explicitly approves the one-time viewing-key transfer. Spending seeds are never an acceptable substitute.
