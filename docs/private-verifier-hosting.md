# Private verifier hosting boundary

Status: design only. No infrastructure is provisioned and no wallet, viewing key, transaction, payout, signature, or broadcast is authorized.

The public Render service must never run a Zcash node or wallet. A live source verifier needs a separate private Linux VM funded by student-cloud credits or another explicitly approved compute grant. It must remain operational without a developer laptop.

## Required topology

1. A dedicated VM runs a pinned Zebra testnet full node with durable block state. Zebra RPC binds only to loopback or a private interface.
2. The same private security boundary may run the pinned `zecd` watch-only wallet and the one-shot `pnpm verifier:relay` worker. `zecd` holds only a separately approved UFVK and wallet scan database, never a seed or spending key. Its RPC binds exactly to loopback with authentication.
3. The worker initiates outbound TLS connections to the judge Neon database, claims encrypted signed challenges, queries only loopback `zecd`, and submits signed results. It exposes no public listener. A cloud firewall denies all inbound traffic except operator SSH through an allow-listed/VPN path and optional Zebra testnet P2P if deliberately enabled.
4. Coordinator and verifier Ed25519 private keys remain on different hosts. The relay AES key is distinct from the public application's data-encryption key. Credentials use private files backed by an encrypted vault, never command-line arguments or image layers.
5. Base Sepolia verification uses public chain data and can remain read-only. Payout signing and operator mutations are separate manual systems and are not part of this verifier VM.

## Capacity and unavoidable dependencies

Zebra's current official minimum is 2 CPU cores, 4 GB RAM, and 300 GB available disk; its recommended profile is 4 cores, 16 GB RAM, 300 GB disk, and 100 Mbps networking. Its documentation says cached testnet data is currently about 10 GB but requires room to grow, and snapshot extraction can temporarily need roughly twice the state size. Use the official 300 GB disk floor unless a measured, reviewed testnet-only exception is accepted. `zecd` is a light wallet but still requires a self-hosted Zebra or Zakura backend; the upstream chart allocates 10 GiB for wallet identity/cache.

Therefore the practical student-credit request is one persistent VM with at least 2 vCPU, 4 GB RAM, and a 300 GB SSD, with 4 vCPU/16 GB preferred for sync reliability. Credits must cover persistent disk and outbound network as well as compute. Free Render is technically and operationally unsuitable: it provides only 0.1 CPU/512 MB, no persistent disk, and sleeps/restarts.

Unavoidable external dependencies are Zcash testnet peers/DNS seeds, a verified Zebra release or image, pinned `zecd` 0.9.0-rc2 artifacts, durable VM storage and encrypted backups, Neon TLS access, time synchronization, and an operator-controlled secure access path. See [Zebra requirements](https://zebra.zfnd.org/user/requirements.html) and [zecd quickstart](https://zecd.org/quickstart.html).

## Activation gate

Keep the public route disabled unless all of these are evidenced:

- student-credit VM and durable storage are actually available;
- pinned binaries/images and checksums are reviewed;
- Zebra testnet is fully synced and monitored;
- the explicit one-time UFVK ceremony is separately authorized and produces a seedless watch-only `zecd` wallet;
- a known incoming Ironwood output and a non-match pass read-only verification;
- coordinator/verifier identity separation, encrypted relay, expiry, replay, lease, restart, and reorg behavior pass end to end;
- destination test-USDC and gas liquidity are confirmed, the payout sender is fixed and independently verified, and a manual signing/broadcast procedure exists;
- backup/restore, monitoring, incident response, and `UNRESOLVED` handling pass review.

Until then, fixture tests and historical references remain labelled fixtures. They are not evidence that the hosted application can settle a new order.
