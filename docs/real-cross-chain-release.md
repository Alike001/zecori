# Real cross-chain release packet

Evidence date: 2026-10-28. This is a reviewed preparation packet, not authority to create a request, allocate a receiver, unlock a wallet, sign, broadcast, pay, migrate the isolated coordinator, change Render/Neon, or enable a public route.

## Wallet A: exact rc2 signing procedure

The pinned binary is `zecd 0.9.0-rc2`. Its tagged source at commit `56e809fb4a3abf122505a28163321149a8823413` defines the exact RPC shape as:

```text
z_sendmany "<fromaddress>" [{"address":...,"amount":...,"memo":...}, ...] (minconf) (fee) (privacyPolicy)
```

For the approved 0.01 TAZ settlement, the only reviewed request is the following positional JSON-RPC parameter array:

```json
[
  "ANY_ORCHARD",
  [{ "address": "<EXACT_ORDER_BOUND_ORCHARD_ONLY_RECEIVER>", "amount": 0.01 }],
  10,
  null,
  "FullPrivacy"
]
```

`ANY_ORCHARD` is rc2's Orchard-family selector and can select both legacy Orchard and Ironwood notes. It must never be treated as an Ironwood-only selector. The reviewed packet therefore fails unless the fresh ten-confirmation eligible legacy Orchard balance is exactly zero and the exact payment plus fee reserve is available in Ironwood. `FullPrivacy` rejects transparent components and cross-pool value movement. The memo member is omitted entirely: an empty string is parsed as no memo, but omission is less ambiguous and prevents an identifying value from entering the request. An explicit fee is not supported; the `null` placeholder selects wallet-computed ZIP-317 fees. The call returns an operation ID and performs proving/signing/broadcast asynchronously.

Before a separately authorized human sends that request:

1. Re-run read-only Wallet A health. Require the exact wallet, testnet tip, complete enhancement history, locked state, at least 10 confirmations, and enough safe/spendable Ironwood value for the exact amount plus fee reserve. Transparent, Sapling, and legacy Orchard value cannot satisfy this gate.
2. Load the authenticated order and compare the exact order UUID, unexpired status, exact dedicated receiver, exact diversifier, source `1,000,000` zatoshis, and receiver activation height. Re-derive/display no replacement receiver.
3. Construct the request from those bound values. Require exactly one output, `amount: 0.01`, no `memo` key, minconf `10`, fee `null`, and policy `FullPrivacy`. Reject any extra recipient or unknown key.
4. Under separate approval, unlock Wallet A only for the shortest reviewed interval. Never place the passphrase in arguments, logs, history, source, or the coordinator.
5. rc2 cannot separate signing from broadcast: obtain both explicit approvals before the single call. Under the broadcast approval, call `z_sendmany` once from an operator terminal. Immediately persist the returned operation ID against the order before waiting. Never call this RPC from a test or automatic retry.
6. Use `z_waitforoperation`/`z_getoperationstatus` read-only. If the submit response or operation result is ambiguous, stop: inspect the operation registry, wallet history, mempool, and chain before any recovery. Never issue a second `z_sendmany` merely because a client timed out.
7. Record a txid only from a successful operation result, relock immediately, and independently verify exact receiver/output/diversifier, Ironwood pool, activation height/time, canonical block, and 10 confirmations. A txid alone is not settlement evidence.

Automated tests call only an injected in-memory RPC double; they never connect to zecd, unlock, sign or broadcast. The production method string exists only in the operator-side one-attempt workflow after its durable `SUBMISSION_STARTED` transition and two explicit human confirmations.

## Base Sepolia: operator-assisted MetaMask payout

The coordinator and public Render process hold no payout private key. The LP wallet remains in MetaMask in a separate operator Chrome profile. No ordinary application route exposes packet preparation, rehearsal, signing, broadcast, hash recovery, or payout verification.

The human-reviewed signing packet is immutable: order UUID, payout authorization UUID, chain `84532`, expected LP sender, official token contract `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, ERC-20 `transfer` calldata for the order-bound EIP-55 recipient and exact destination atomic amount, reserved sender nonce, EIP-1559 fee bounds, gas limit, creation/expiry times, and packet digest. The signer must independently reconstruct calldata and reject any mismatch.

The no-funds rehearsal validates the persisted approved packet against the selected MetaMask account and fresh Base observations. `eth_sendTransaction` is a wallet confirmation that signs and broadcasts; it returns a transaction hash and does not return signed raw bytes. The repository deliberately contains no provider call to that method and no real browser adapter. The raw-signed transaction path remains available as a separate future integration.

Nonce and duplicate rules:

1. In one signer-side transaction, lock `(chain_id, sender)`, reconcile confirmed and pending nonces, reserve exactly one nonce for the order, and enforce uniqueness on both `(order_id)` and `(chain_id, sender, nonce)`.
2. The MetaMask journal stores one rehearsed request digest. Before a future wallet prompt it changes to `SUBMISSION_STARTED` and the packet enters recovery. A successful response stores only the returned transaction hash and changes to `SUBMITTED`.
3. If the response is lost or ambiguous, restart from the same journal and reconcile wallet activity, transaction lookup, receipt, latest nonce, and pending nonce. Never issue a second transfer automatically. MetaMask does not provide raw bytes for byte-for-byte rebroadcast through this path.
4. Cancellation is allowed only before signing. After signing, timeout, replacement, reorg, or sender-nonce conflict moves the operation to `RECOVERY_REQUIRED` for human reconciliation.
5. The coordinator records only the externally returned hash after independent packet/hash comparison. Existing replay references enforce one payout transaction per order and reject a transaction reused by another order.
6. Completion requires a matching canonical transaction body plus a canonical receipt with at least three confirmations and exactly one official-contract `Transfer` from the bound LP sender to the immutable recipient for the exact amount. Reorged, removed, duplicate, wrong-sender, wrong-chain, wrong-token, changed calldata/value/nonce/fees, underpaid, or overpaid evidence cannot complete the order.

The repository now creates and journals a non-signing packet, performs an operator-only no-funds MetaMask rehearsal, enforces durable one-attempt/recovery states, retains raw-signed verification, and independently verifies the eventual canonical transaction and receipt. Real MetaMask invocation remains deliberately disabled. Payout execution therefore remains **BLOCKED pending separate transaction authorization and a reviewed browser adapter enablement**.

## Hosted readiness

The public origin is healthy and fail-closed. Its downloaded JavaScript and CSS hashes reproduce exactly from commit `8374687469b701b61c39e8495cf783ab1d9f316b`, so the current Render deployment is behind GitHub `main` (`5fe4bd09f4ec9d3c7eaf52499c4d3b6948d24f23`). No deployment change was made. Route requests, liquidity, ERC-1271, Privy, and voice remain disabled; the public API exposes no variable quote or payout execution.

A no-card third-party VM with durable private disk is not presently verified. Render free web services have ephemeral files, no persistent disks/private services/background workers, and may sleep/restart. Oracle's free-account signup requires a payment-verification card, and Fly.io requires a card for ordinary organizations. The practical no-card option is operator-owned hardware other than the developer laptop, with encrypted durable storage and outbound-only authenticated relay (Tailscale Serve can provide private operator access; Funnel is unnecessary). Until such hardware is supplied and survives backup/restore/restart acceptance, do not export a UFVK. Official references: [Render free limits](https://render.com/docs/free), [Render disks](https://render.com/docs/disks), [Oracle signup](https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-Sign_Up_for_Free_Oracle_Cloud_Promotion.htm), [Fly.io pricing](https://fly.io/docs/about/pricing/), and [Tailscale Funnel/Serve](https://tailscale.com/docs/features/tailscale-funnel).

Payout signing remains in the separately controlled MetaMask Chrome profile. A real transaction requires an operator authorization ceremony, confirmed profile/account custody, the durable coordinator journal, backup/recovery acceptance, a profile-backed no-funds rehearsal, and reviewed enablement of the otherwise absent browser adapter. That evidence does not yet exist.

## Release matrix

| Area | Status | Evidence / blocker |
| --- | --- | --- |
| Owner-bound passkey request + EIP-712 EOA proof | WORKING | Owner/session/intent/origin/nonce/expiry binding and replay rejection pass PostgreSQL tests. |
| Exact-diversifier Orchard allocation | LOCALLY TESTED | Durable journal and ambiguous-RPC recovery pass; no receiver was allocated in this review. |
| Wallet A Ironwood health | LOCALLY TESTED | Fresh read-only RPC reports locked/synchronized and 98,465,000 usable ten-confirmation Ironwood zatoshis (the request stated 9,846,500); no unlock occurred. |
| Wallet A rc2 send procedure | PREPARED / NOT EXECUTED | Operator-only preview, encrypted packet preparation, dual-confirmation submission boundary, non-destructive opid recovery, restart durability, terminal relock and no-repeat failure paths pass with RPC doubles and disposable PostgreSQL. No real unlock, signing or broadcast was performed. |
| Source canonical verification + relay | LOCALLY TESTED | Required pool, exact amount/output/diversifier, activation height/time, canonical block, confirmations, signed relay, replay, expiry, and unresolved paths pass. |
| Persistent multi-amount reservations | LOCALLY TESTED | Migrations 011–013 bind quotes to owner requests, verified intents, receiver allocations, separate payment/confirmation deadlines, canonical Ironwood evidence, immutable revocation history, and recovery liabilities; disposable PostgreSQL covers 0.01/0.02/0.05, concurrency, restart, expiry, confirmation delay, reorg, and payment mismatch. Not wired publicly. |
| Base receipt verification | LOCALLY TESTED | Exact official-token Transfer, sender, recipient, amount, canonical block, confirmation, replay, and receipt authentication pass. |
| MetaMask payout path | PREPARED / DISABLED | Operator-only packet rehearsal, nonce constraints, durable recovery, restart, and canonical verification are locally tested. No real `eth_sendTransaction` call exists or is enabled. |
| First owner-bound request | BLOCKED BY APPROVAL | Prerequisites can be reviewed, but creation is a durable mutation and was not authorized. |
| First linked settlement/receipt | BLOCKED | No genuine source txid, payout txid, or authenticated linked receipt exists. |
| Render public application | WORKING | HTTPS/health/smoke pass with financial flags closed; deployed assets reproduce commit `8374687`, not current main. |
| No-card persistent watch-only host | BLOCKED | No verified third-party no-card durable VM; operator-owned non-laptop hardware is the viable path. |

Only genuine independently verified transaction identifiers and the authenticated receipt may be added after the separately approved settlement completes.
