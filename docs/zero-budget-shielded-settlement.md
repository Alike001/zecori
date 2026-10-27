# Zero-budget shielded settlement feasibility

Assessment date: 2026-10-27

Implementation branch: `feat/zero-budget-shielded-settlement`

Disposition: **source verification is feasible on a zero-cost candidate host; end-to-end settlement remains blocked and all public financial gates stay disabled.**

No wallet was started, imported, unlocked or funded. No address was allocated. No transaction was signed or broadcast. No public Neon or Render state was changed.

## Verified current evidence

- The reviewed zecd `v0.9.0-rc5` Linux amd64 release archive matched its GitHub release SHA-256 (`44495fd...306eca`). Its source revision is `0276c98b...e151`.
- `zecd --testnet chain-info --server zecrocks --json` succeeded at 2026-10-27 18:48 UTC: chain `test`, height `4548361`, branch `77190ad9`, no unsupported upgrades, `network_matches: true`, and `usable: true`.
- Direct gRPC against `testnet.zec.rocks:443` reported lightwalletd `v0.5.4`, chain `test`, Zcash backend `v7.0.0`, protocol `v0.5.0`, and a tip within seconds of local UTC. A 101-block recent range contained 58 explicit `ironwoodActions` fields, and the tip carried an Ironwood commitment-tree size.
- TLS hostname verification succeeded for `testnet.zec.rocks`; the observed leaf certificate was valid from 2026-10-15 through 2027-01-13. This is transport authentication evidence, not proof that the operator is honest or independent.
- The separately advertised `https://lwd.testnet.zec.pro` endpoint was **not usable**: HTTPS and gRPC returned Cloudflare 521, and the reviewed zecd probe exited non-zero. `explorer.testnet.zec.pro` also returned 521. It must not be configured despite the public page labelling it Live.
- zecd source implements continuity checking through compact-block `prev_hash`, rewinds on reorgs, starts with a ten-block margin, widens on consecutive conflicts, and halts an unrecoverable reorg. This is reviewed implementation/test evidence, not a live hosted reorg drill.
- The official Base Sepolia RPC returned chain ID `84532`, current canonical block data, and non-empty code at Circle's official test-USDC contract `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. The repository's historical read-only Base verifier fixture passed live. No liquidity or signer was inspected.

Primary references: [zecd configuration](https://zecd.org/configuration.html), [zecd source](https://github.com/zecrocks/zecd), [Zebra requirements](https://zebra.zfnd.org/user/requirements.html), [ZEC.PRO](https://zec.pro/), [Base network details](https://docs.base.org/get-started/connect-to-base), [Circle testnet USDC contracts](https://developers.circle.com/stablecoins/usdc-contract-addresses), and [Noir integration security](https://docs.zknoir.com/developers/security/).

## Existing architecture retained

The implementation does not introduce another settlement system:

1. PostgreSQL journals an exact diversifier before the single guarded allocation RPC and enforces unique allocation/replay references.
2. An operator-only allocator derives exactly that Orchard receiver and binds it to immutable order terms.
3. A private verifier reads an independently operated zecd wallet, verifies one owned non-change Ironwood output, and returns encrypted Ed25519-signed evidence through the existing relay.
4. The coordinator separately applies detection and ten-confirmation evidence.
5. Payout requires an immutable Base recipient, EIP-712 control proof, operator authorization, an external signer, and independent canonical event verification.

The browser, assistant and public Render service have no allocation, wallet RPC, signing, broadcast or payout tools.

## Exact zecd compatibility map

| Requirement | Existing call/evidence | zecd lightwalletd-backed result | Decision |
| --- | --- | --- | --- |
| Exact testnet and current tip | `getblockchaininfo` | Local wallet scan exposes `chain`, `blocks`, `headers`, `bestblockhash`, `time`, IBD and upstream warning state | Supported. Zecori now rejects missing identity/time, warnings, clock lead, and tips older than 30 minutes. |
| Wallet scan complete | `getwalletinfo` | `scanning === false`, `enhanced_through === blocks`, no `import_error` | Supported. Enhancement backlog must be drained. |
| Watch-only verifier custody | `getwalletinfo.private_keys_enabled === false` | UFVK wallet is explicitly supported by `zecd init --ufvk` | Supported for verification only. UFVK ceremony is not yet authorized or tested here. |
| Locked spending-wallet fallback | `private_keys_enabled === true`, `unlocked_until === 0` | Supported | Retained; never unlock in the relay. |
| Owned exact receiver/diversifier | `getaddressinfo` | zecd extensions expose ownership, Orchard capability, receiver consistency and exact diversifier | Supported by current source and repository fixtures. |
| Fresh receiver allocation | `z_getaddressforaccount(0, ['orchard'], exactIndex)` | Supported, including exact large JSON integer | **Not read-only.** It remains the sole separately authorized mutation, journaled before RPC. The relay adapter never calls it. |
| Collision/history protection | paginated `z_listtransactions` plus PostgreSQL unique journal | Per-output address/diversifier history is local wallet data | Supported; interrupted derivation reconciles the same index and never selects a replacement. |
| Incoming owned Ironwood output | `z_listtransactions` | `pool`, `category`, `outgoing`, `change`, `amountZat`, address, diversifier and outindex are zecd extensions | Supported. Exactly one match is required; ambiguous/false evidence is unresolved. |
| Exact amount/order boundary | integer zatoshis + allocation height/time | Local wallet history plus signed challenge binding | Supported. No floating-point comparison. |
| Canonical block and confirmations | `gettransaction`, `getblockhash(blockheight)` | Both are served from zecd's scanned canonical wallet state | Supported. Detection may use one confirmation; settlement requires ten. |
| Reorg handling | zecd continuity rewind plus Zecori block-hash recheck | Implemented and unit-tested upstream; Zecori reports noncanonical evidence as `REORG_DETECTED` | Hosted restart/reorg drill still required. |
| One-time evidence/replay | signed nonce/job/manifest/request fingerprints plus PostgreSQL unique references | Independent of zecd backend | Supported and integration-tested. |
| Private records/relay | AES-encrypted jobs/messages, distinct Ed25519 identities, TLS PostgreSQL | Independent of zecd backend | Supported in code; production key ceremony and host deployment remain unverified. |
| Public receipt privacy | shareable receipt omits source/destination txids, shielded receiver, exact settlement amounts and private correlation | Independent of zecd backend | Supported and tested. |

A public lightwalletd is a chain-data dependency, not an independent full-node proof. It can omit, delay or fork the view it serves. TLS authenticates the endpoint but cannot make its chain honest. Therefore evidence may be described as independently verified from the public application/operator submission, but not as independently validated by a Zecori full node.

## Hosting designs

### A — persistent private zecd watch-only verifier

- One eligible OCI Ampere A1 Always Free VM: current official allowance is 2 OCPUs and 12 GB RAM total, plus 200 GB combined boot/block storage in the home region. Nominal in-limit cost is $0, but signup/payment-card verification, regional capacity, quota and idle-instance reclamation remain provider risks.
- Run a pinned checksum-verified zecd release with a separately approved UFVK, durable SQLite/checkpoints, loopback authenticated RPC and an RPC method allowlist. Run the outbound-only relay worker under a separate OS identity. No seed or spending key exists on this host.
- Use `server = "zecrocks"` (currently `testnet.zec.rocks:443`) with native hostname/certificate validation. Do not use `tls_insecure_skip_verify`. Leaf pinning is optional only with a documented overlapping rotation procedure; a single expiring leaf pin is an availability risk.
- Encrypt the volume and backup the zecd wallet database/checkpoint plus relay configuration; store UFVK and relay key material outside logs, images, argv and Git. A UFVK is sensitive metadata authority even though it cannot spend.
- Monitor `zecd chain-info`, `/readyz`, tip age/hash, scan/enhancement backlog, relay lease age, disk, clock, certificate expiry and endpoint divergence. Stop as `UNRESOLVED` on stale/unavailable upstream.
- This design can run without a laptop **if** an eligible VM can actually be provisioned and survives provider capacity/reclamation policy. It is the only genuinely achievable zero-budget candidate found.

### B — Zebra plus zecd watch-only verifier

- Zebra's official minimum is 2 cores, 4 GB RAM and 300 GB available disk; recommended is 4 cores, 16 GB and 300 GB. Current testnet cache is documented around 10 GB but grows, and snapshot extraction can need roughly twice the state.
- OCI Always Free's current 2-core/12-GB/200-GB allowance does not meet Zebra's official 300-GB disk floor and does not meet the recommended CPU/RAM profile. The earlier 4-core/24-GB assumption is no longer current.
- A measured 200-GB testnet exception might work technically, but it would be outside the official floor and cannot be labelled safe zero-budget production infrastructure. Extra disk or a larger VM is paid, credited or donated infrastructure.
- Zebra removes the single public-lightwalletd chain-view dependency and is the preferred stronger design once compliant durable capacity is funded.

## Noir Wallet acceptance

No Noir transaction method was enabled or called. The repository probe still calls only silent `zcash_getAccounts`; official docs say detection does not connect, while `connect()` requires deliberate user action and sends require wallet approval.

The isolated smoke was not run because no separately checksum-verified official `-testnet.zip` and fresh disposable unfunded wallet were supplied. More importantly, the v1 account response does not attest the installed network build or prove an Ironwood-spendable source. Manifest naming and a `utest` address are useful corroboration, not sufficient cryptographic network/pool attestation. This path remains **BLOCKED** until an approved human test packet can establish build checksum, isolated profile, fresh wallet identity, completed sync, shielded/Ironwood spendability, exact method ledger and deletion evidence. No signing or send is part of that packet.

## Base payout review

- Network: official Base Sepolia chain ID `84532`; exact-chain checks occur before recipient proof, health and payout verification.
- Token: Circle's official testnet USDC contract is fixed in code; arbitrary token contracts are rejected.
- Recipient: owner/session/intent/origin/nonce/expiry/chain/recipient are bound in EIP-712. EOA recovery must equal the immutable recipient. ERC-1271 remains disabled unless separately enabled and rechecked at settlement.
- Sender: the verifier requires the operator-confirmed external LP sender and exactly one matching `Transfer` event for recipient and `1,000,000` atomic units.
- Finality: successful receipt, canonical receipt block, transaction membership and at least three confirmations are required. A removed or reorged log fails.
- Signer/liquidity: no signer exists in this repository and no key is accepted by the public service. Current LP test-USDC and gas balances are unknown, so payout is blocked. There is no automatic retry or nonce recovery; ambiguity becomes `UNRESOLVED`.

## Reproducible nonfinancial evidence

Covered locally:

- stale/refused/future/missing-identity/wrong-chain Zcash tip;
- unavailable RPC classification;
- false, outgoing, change, wrong-pool, mismatched-amount, missing-index and duplicate source evidence;
- exact-diversifier mismatch, prior history, concurrent/double allocation, interrupted allocation reconciliation and restart persistence;
- forged coordinator/verifier identity, stale signed evidence, replay and manifest/request substitution;
- Base wrong chain, missing liquidity, sender/recipient/amount/contract mismatch, duplicate event and noncanonical block;
- all public execution flags and wallet mutation boundaries remain fail-closed.

Still requires hosted evidence: actual UFVK watch-only import, full rescan/restart, live reorg/failover drill, endpoint outage recovery, encrypted backup restore, monitoring alerts, and one newly linked two-chain transaction.

## First achievable testnet payment procedure

Every numbered approval is separate; completing one does not authorize the next.

1. Approve/provision Design A, pin the reviewed zecd artifact, harden the host, and demonstrate restart/backup/monitoring with a valueless disposable UFVK wallet.
2. Approve a one-time Wallet B UFVK export/import ceremony. Confirm the verifier holds no seed and the spending wallet remains encrypted and locked.
3. Run read-only chain/wallet compatibility and known-match/non-match acceptance. Compare tip/hash against a second independently operated source; stop on divergence.
4. Approve and verify operator testnet liquidity and gas, fixed LP sender, immutable Base recipient/control proof, and external signer procedure. Do not place signer material on Render or the verifier.
5. Create one owner-scoped request while public route creation remains disabled; accept it through the operator CLI.
6. Separately authorize exactly one journaled receiver allocation and publish payment instructions only after the receiver is durably reserved.
7. Separately authorize a human-controlled Noir or Wallet A payment procedure using exactly `1,000,000` zatoshis from Ironwood/shielded funds, with empty memo. This repository still has no send command.
8. Apply signed source detection, wait for ten canonical confirmations, then apply signed confirmation. Any ambiguity stops the order.
9. Separately approve one external Base payout of exactly `1,000,000` test-USDC atomic units. Record only the returned txid; never auto-broadcast or retry.
10. Verify three canonical Base confirmations and the exact official-contract event, authenticate the private receipt, then inspect the privacy-safe public receipt.
11. Only after independent evidence review consider a separate change to public route/liquidity flags.

## Precise next operator action

No financial action is next. The next safe action is to obtain an eligible private VM and run the checksum-verified, walletless upstream gate:

```sh
/opt/zecori/bin/zecd --testnet chain-info --server zecrocks --json
```

Record UTC, binary checksum/version, TLS certificate chain, chain/network match, tip height/hash/age, branch ID and unsupported-upgrade list. Then stop. Do not import a UFVK, start a wallet, allocate an address or enable public flags until that infrastructure packet is reviewed and separately approved.

## Settlement blockers

1. No approved persistent private host or hardened durable deployment exists.
2. No authorized UFVK ceremony or hosted watch-only rescan/restart evidence exists.
3. The selected public lightwalletd is a trusted external chain view; independent full-node validation is absent.
4. Noir testnet build/network/Ironwood source acceptance is incomplete.
5. Wallet A/Noir source funding and human signing procedure are not authorized or proven.
6. LP test-USDC/gas liquidity, fixed external signer, nonce/recovery runbook and one live payout are unverified.
7. Hosted reorg, outage, backup/restore and alerting acceptance are incomplete.
8. No newly linked Ironwood-to-Base transaction has produced independently reviewed chain evidence.

Accordingly, the route is not operational end to end yet, and Zecori must not claim otherwise.
