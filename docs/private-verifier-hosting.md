# Private verifier hosting boundary

Status: candidate design verified, infrastructure not provisioned. No wallet, viewing key, transaction, payout, signature, or broadcast is authorized. See [zero-budget shielded settlement feasibility](zero-budget-shielded-settlement.md) for the current endpoint probes, compatibility map and hosting decision.

The public Render service must never run a Zcash node or wallet. A live source verifier needs a separate private Linux VM. The current zero-cost candidate is an eligible OCI Always Free A1 instance running a pinned watch-only zecd against the verified zec.rocks testnet endpoint; actual account eligibility, capacity and reclamation risk remain unverified. It must remain operational without a developer laptop.

## Required topology

1. The zero-cost candidate VM runs a pinned `zecd` watch-only wallet with durable scan state and an authenticated TLS lightwalletd upstream. The stronger funded design adds a pinned Zebra testnet full node whose RPC binds only to loopback or a private interface.
2. The same private security boundary may run the one-shot `pnpm verifier:relay` worker. `zecd` holds only a separately approved UFVK and wallet scan database, never a seed or spending key. Its RPC binds exactly to loopback with authentication and a read-only method allowlist.
3. The worker initiates outbound TLS connections to the judge Neon database, claims encrypted signed challenges, queries only loopback `zecd`, and submits signed results. It exposes no public listener. A cloud firewall denies all inbound traffic except operator SSH through an allow-listed/VPN path and optional Zebra testnet P2P if deliberately enabled.
4. Coordinator and verifier Ed25519 private keys remain on different hosts. The relay AES key is distinct from the public application's data-encryption key. Credentials use private files backed by an encrypted vault, never command-line arguments or image layers.
5. Base Sepolia verification uses public chain data and can remain read-only. Payout signing and operator mutations are separate manual systems and are not part of this verifier VM.

## Capacity and unavoidable dependencies

Zebra's current official minimum is 2 CPU cores, 4 GB RAM, and 300 GB available disk; its recommended profile is 4 cores, 16 GB RAM, 300 GB disk, and 100 Mbps networking. Its documentation says cached testnet data is currently about 10 GB but requires room to grow, and snapshot extraction can temporarily need roughly twice the state size. Use the official 300 GB disk floor unless a measured, reviewed testnet-only exception is accepted. zecd can instead use an HTTPS lightwalletd backend; this removes Zebra's local resource cost but trusts that upstream's chain view and availability.

OCI's current Always Free allowance is 2 A1 OCPUs, 12 GB RAM and 200 GB combined boot/block storage. That can host Design A at a nominal $0 within quota, subject to signup/card, regional capacity and idle-reclamation risks. It does not meet Zebra's official 300 GB disk floor, so Design B needs paid, credited or donated capacity. Free Render remains technically and operationally unsuitable: it provides only 0.1 CPU/512 MB, no persistent disk, and sleeps/restarts.

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
