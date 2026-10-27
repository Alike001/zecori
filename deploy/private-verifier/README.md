# Private watch-only verifier deployment packet

This is the smallest zero-budget candidate for the first linked test: one private
OCI Ampere A1 Always Free VM (2 OCPUs, 12 GB RAM and up to 200 GB combined
boot/block storage within the current allowance), pinned `zecd v0.9.0`, the
`zecrocks` testnet lightwalletd preset, durable wallet scan state, and the
existing outbound signed relay worker.

Free Render is not an alternative. Its free web service has no persistent disk,
can restart at any time, and is not an appropriate boundary for a viewing key.
The public Render service must retain no UFVK, wallet database or relay private
key.

## Pinned release

- Upstream tag: `v0.9.0`
- Source commit: `0276c98b5d4cb2aa05b0b87a509899100eb0e151`
- Linux arm64 archive SHA-256: `785bcf54abc3293818a5a2d6601af75a6afe15783f532b16ef83245ffe111417`
- Linux amd64 archive SHA-256: `bda748b9f5d75092c7a7019fad50bcfe1ad47d329d8e1fa3740b203dd5b62bf3`

Verify the downloaded archive against both the release `SHA256SUMS` and the
digest above. Validate `zecd.toml` with that binary before installing the units.
Do not use either unit until the host filesystem, firewall, time sync, encrypted
backup target, and restore procedure have been reviewed.

## Authorization boundaries

1. Walletless `chain-info --server zecrocks --json`, TLS, and configuration
   validation are read-only infrastructure checks.
2. `zecd init --ufvk` is a separate one-time authorization. Enter the UFVK
   through the operator-controlled prompt; never place it in a command,
   environment file, shell history or deployment automation.
3. Starting the watch-only service is separately authorized after initialization.
4. The relay is enabled only after distinct coordinator/verifier Ed25519 keys,
   the relay encryption keyring, TLS PostgreSQL transport, and backup/restore
   evidence pass review.
5. Address allocation remains on the guarded Wallet B allocator. The watch-only
   service cannot allocate, sign, unlock, broadcast, or pay out.

Set `ZECATHON_VERIFIER_ZECD_DATA_DIR=/var/lib/zecori-zecd` in the private
mode-0600 `relay.env`; this is a non-secret path and lets the relay read the
loopback RPC cookie without exposing it. Point the remaining relay variables to
private files rather than embedding any key bodies in `relay.env`.

After each restart, run `pnpm settlement:readiness`. The private verifier must
report seedless watch-only custody, a current testnet tip, and complete enhanced
history before it may answer a signed job. Any mismatch or stale state is
`BLOCKED`/`UNRESOLVED`, never success.
