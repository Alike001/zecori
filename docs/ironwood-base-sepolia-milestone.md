# Ironwood → Base Sepolia first-settlement milestone

Evidence date: 2026-10-27. Branch: `feat/ironwood-base-sepolia-settlement`.

This packet records implementation and nonfinancial validation. It does **not**
claim that the linked settlement occurred. No wallet was started, unlocked,
imported, allocated from, signed with or asked to broadcast. No payout was
submitted, no live Neon or Render state changed, and no public financial flag
was enabled.

## Readiness table

| Gate | Status | Exact evidence |
| --- | --- | --- |
| Focused branch from latest main | PASSED | `origin/main` at `8374687`; branch created after a fast-forward-only update. |
| Final zecd release provenance | PASSED | `v0.9.0`, source `0276c98b5d4cb2aa05b0b87a509899100eb0e151`; amd64 archive SHA-256 `bda748b9f5d75092c7a7019fad50bcfe1ad47d329d8e1fa3740b203dd5b62bf3` matched. |
| zecrocks testnet/TLS/Ironwood-era tip | PASSED | Walletless final-binary probe: lightwalletd `v0.5.4`, protocol `v0.5.0`, chain `test`, height `4548664`, hash `00002ceaa13aec6a62335aecb235d3b1bbc75393a476295b8f513dcad1141142`, branch `77190ad9`, no unsupported upgrades, usable. TLS leaf CN `testnet.zec.rocks`, SHA-256 `31:0A:31:B0:9A:FF:CF:67:98:55:E7:12:85:C0:A8:6B:E0:BF:31:58:08:39:2B:32:A4:88:7D:CB:B9:64:82:B9`, valid 2026-10-15 through 2027-01-13. |
| Smallest zero-budget private host | PASSED (design) | OCI A1 Always Free currently permits 2 OCPUs, 12 GB RAM and 200 GB combined boot/block storage; `deploy/private-verifier` contains a v0.9.0-validated zecd config and hardened systemd units. Free Render is rejected because it has no persistent disk and may restart at any time. Actual OCI eligibility/capacity remains an external provisioning blocker. |
| Private watch-only restart state | BLOCKED | New health gate requires exact wallet identity, `private_keys_enabled=false`, no unlock state, current testnet tip and complete enhancement history. No private host/UFVK wallet was initialized or restarted. Wallet B port `18393` was not listening. |
| Wallet A current Ironwood funds | BLOCKED | Existing private directory and mode-0600 `keys.toml` validated and the application reference exists, but port `18392` was not listening. Current sync, lock state and `>=1,010,000` safe ten-confirmation Ironwood zatoshis were not measured. |
| Noir testnet 1.0.40 acceptance | BLOCKED | The only local unpacked bundle is testnet `1.0.39`; the required reviewed `1.0.40` archive/profile was not supplied. The code now probes exact shielded `getMaxTransfer` without send/sign APIs, rechecks the account, and still refuses to treat provider version/balance as network or Ironwood attestation. |
| Base chain/token endpoint | PASSED | Live read-only RPC: chain `84532`, canonical block `51061585`, official Circle test-USDC bytecode present at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. |
| Bound payout identity/liquidity | PASSED (read-only) | Private operator config validated distinct bound accounts without printing them. Live balance: `31,327,251` test-USDC atomic units and `999,628,910,769,908` wei; minimums are `1,000,000` and `100,000,000,000,000`. External signer execution/recovery is still BLOCKED. |
| Destination proof/replay/expiry/recipient safety | PASSED | Fresh PostgreSQL integration covered expiring single-use EIP-712 proofs, owner/session binding, signer substitution, concurrency, immutable recipient, duplicate requests and restart. Unit tests cover chain/account changes, invalid/manual recipients, and byte-identical visible/copy/QR receiver channels. |
| Fresh isolated PostgreSQL | PASSED | Disposable PostgreSQL `17.7-alpine`; all 11 migration/integration tests passed, including allocation crash recovery, signed-relay replay rejection, two-stage source evidence and authenticated receipt. Container stopped after the run. |
| Real 0.01 TAZ source transaction | BLOCKED | No fresh receiver allocation or transaction authorization was given; no source txid exists for this order. |
| Real 1 test-USDC payout and receipt | BLOCKED | No order/source evidence/payout authorization or external broadcast exists; therefore no linked Base txid or authenticated live receipt exists. |

Run `pnpm settlement:readiness` for a sanitized, read-only current snapshot. A
nonzero exit means at least one gate is blocked or failed; it never performs a
financial action.

## Exact first-settlement procedure

The current Wallet A/B state has been confirmed only as: private directories and
references exist, both processes are stopped, and live wallet state is unknown.
Accordingly this procedure is paused before step 1. Every bold authorization is
separate and applies to that step only.

1. Provision the reviewed private OCI host, install the checksum-matched zecd
   release, validate the checked-in config, run the walletless chain/TLS probe,
   and prove encrypted backup/restore plus service restart with no UFVK present.
2. **Authorize the one-time Wallet B UFVK ceremony.** Export it from the locked
   operator wallet without displaying/logging it, initialize the seedless private
   watch wallet through an operator-controlled prompt, sync fully, restart, and
   require `pnpm settlement:readiness` to pass watch-only custody/history.
3. **Authorize starting Wallet A and Wallet B locked.** Run the existing read-only
   checks. Stop unless Wallet A proves at least `1,010,000` safe, spendable,
   ten-confirmation `ironwood` zatoshis and Wallet B is current/locked. This does
   not authorize unlock, derivation or payment.
4. Complete checksum-verified Noir `1.0.40` acceptance in a disposable profile:
   explicit connect approval and rejection, account switch invalidation, full
   sync, shielded/available balance, and recipient-aware shielded
   `getMaxTransfer`. Record only sanitized outcomes. Never call a send method and
   never use transparent funding.
5. Connect the exact Base Sepolia recipient wallet, require chain `84532`, and
   complete its owner/session/intent/origin/nonce/expiry-bound EIP-712 proof.
   Recheck account/chain after signing. A manually entered address remains an
   intent until this exact proof succeeds.
6. On a fresh reviewed PostgreSQL instance, create one owner-scoped request and
   operator-accept it. **Authorize one exact-diversifier allocation.** Run only
   `authorize-allocation`, then separately `allocate-address`; reconcile the same
   journal on ambiguity and never derive a replacement. Publish instructions
   only after byte-identical visible/copy/decoded-QR comparison.
7. **Authorize one Wallet A payment.** Human-review the immutable order, exact
   fresh receiver, `1,000,000` zatoshis, empty memo, expiry and fee; unlock/sign/
   broadcast only in Wallet A. The repository has no send command. Stop and save
   the returned txid once; never auto-retry.
8. Queue signed source detection through the private relay, independently apply
   it, wait for 10 canonical Zcash confirmations, then queue/apply source
   confirmation. Any stale, duplicate, noncanonical or mismatched evidence makes
   the order `UNRESOLVED`.
9. Queue payout review, then **separately authorize payout approval**. Human-review
   LP sender, recipient, official token, `1,000,000` atomic units, nonce and gas.
   **Separately authorize the external signer to broadcast once.** Record only
   its returned Base txid; never auto-retry an ambiguous submission.
10. After 3 canonical Base confirmations, verify exactly one official-contract
    `Transfer` from the bound LP sender to the immutable recipient for exactly
    `1,000,000` atomic units. Authenticate the private receipt and independently
    compare both explorers/RPCs. Only then may the milestone be marked complete.

Public route/liquidity flags remain off. Enabling them, changing Render, pushing,
deploying, or publishing private evidence requires separate authorization after
the real linked transaction has passed independent review.
