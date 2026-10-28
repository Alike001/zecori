# First real linked settlement — operator runbook

Status: prepared, not authorized. This runbook does not authorize request creation, receiver allocation, wallet unlock, Zcash submission, Base signing, Base broadcast, or payment. Every boundary below needs a new, explicit human approval naming the order and exact terms.

## Shortest remaining path

`owner/passkey request -> verified EIP-712 recipient intent -> operator acceptance -> authorized journaled Wallet B receiver -> published instructions -> reviewed Wallet A packet -> z_sendmany opid/txid recovery -> canonical source detection -> 10 confirmations -> one-time payout approval -> external Base packet/signature/broadcast -> canonical ERC-20 Transfer + 3 confirmations -> signed linked receipt`

The code and synthetic fixtures cover the lifecycle boundaries and failure cases described below. The first real request, receiver, source transaction, external signer rehearsal, payout transaction, and linked receipt do not yet exist. The external Base signer/nonce authority is the shortest hard infrastructure blocker.

## Read-only preflight

Before asking for any mutation approval:

1. Check out the reviewed local commit and require a clean tracked worktree. Preserve `.thoughts`, wallet data, keys, backups, and the isolated database. Confirm migrations 001–012 on a clone/disposable database before migrating the isolated coordinator.
2. Keep Render/Neon financial routes, variable quotes, AI, voice, and hosted signing disabled. Confirm TLS/auth health without deploying.
3. Run `pnpm operator -- status`, `pnpm operator -- pending-requests`, and `pnpm operator -- orders` against the isolated coordinator. Require no unresolved authorization, allocation, source, payout, or replay reference.
4. Load the mode-0600 operator configuration. Require Base Sepolia chain `84532`, the interactively confirmed LP sender, official Circle test-USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, sufficient exact payout liquidity, gas, and a current pending nonce from two agreeing Base RPC observations.
5. Read Wallet A only. Require the configured owned spending wallet, `zecd 0.9.0-rc2`, Zcash testnet, synchronized tip, complete enhancement history, locked state, and `listunspent(10, ...)` entries that are safe/spendable/solvable and explicitly pool-labelled. Reconcile the reported `9,846,500` versus the previously observed `98,465,000` Ironwood zatoshis; proceed only from a fresh exact result.
6. Require at least `source amount + 10,000` confirmed Ironwood zatoshis and exactly zero eligible legacy Orchard zatoshis. `ANY_ORCHARD` selects the Orchard family; it does **not** prove Ironwood-only selection.
7. Read Wallet B only. Require the configured wallet, synchronized tip, complete history, locked state, and no unresolved allocation journal.

## Authorization boundaries

### 1. Owner request and destination proof

With separate approval, the owner creates one passkey-bound request and signs its EIP-712 Base recipient challenge. Before acceptance, independently verify the authenticated owner/session, origin, nonce, expiry, chain `84532`, official token, exact EIP-55 recipient, exact atomic amounts, and `VERIFIED` wallet proof. Variable quotes remain internal and disabled; if used in a future test, migration 012 requires the exact owner request, confirmed intent, proof, rate approval, source zatoshis, USDC atomic amount, recipient fingerprint, liquidity, and expiry.

### 2. Operator acceptance

With a new approval, run the interactive `accept-request` command with the exact terms confirmation. Review the signed immutable order manifest before continuing.

### 3. Receiver allocation

Receiver allocation is a wallet mutation and needs its own approval. Issue the scoped allocation authorization, then execute `allocate-address` once. Require the returned receiver to be Wallet B-owned, Orchard-only, unused by both address and exact diversifier, journaled before use, and bound to the order and activation height. On an ambiguous RPC response, use only `reconcile-allocation`; never allocate a replacement until the journal is resolved. Publishing instructions is another explicit mutation approval.

### 4. Wallet A unlock, shielded submission, and recovery

Build and persist the reviewed packet from the exact active order and fresh Wallet A health. For 0.01 TAZ its rc2 RPC parameters must be exactly:

```json
["ANY_ORCHARD", [{"address":"<EXACT_JOURNALED_ORDER_RECEIVER>","amount":0.01}], 10, null, "FullPrivacy"]
```

The destination object has no `memo` member. There is one receiver and one amount; minconf is `10`; fee is `null` for wallet-computed ZIP-317; privacy is `FullPrivacy`; the order must be unexpired. Reject legacy Orchard eligibility, pool crossing, a changed receiver/diversifier, any extra output/key, or insufficient Ironwood fee reserve.

`zecd 0.9.0-rc2` performs proving/signing and broadcast asynchronously inside the single `z_sendmany` operation; it cannot provide a separately exportable signed transaction. Therefore obtain and journal both the wallet-unlock approval and the broadcast approval **before** making that one call. Unlock only through the approved secret-safe terminal flow and for the shortest interval. Call once, never from a test or automatic retry, and persist the returned opid immediately.

If the client times out or the response is lost, mark the packet `SUBMISSION_AMBIGUOUS`/`RECOVERY_REQUIRED`. Inspect the operation registry, wallet transactions, mempool, and chain by packet/order/receiver/amount before doing anything else. Recover the discovered txid into the same journal. Never call `z_sendmany` again merely because the first response was ambiguous. Relock immediately after the operation completes or fails.

### 5. Source evidence and 10 confirmations

Queue signed private-relay detection with the real txid. Independently require the exact journaled receiver and diversifier, exact zatoshis, Ironwood output, activation height/time, canonical block hash, and no evidence conflict. At 10 confirmations, rerun canonical verification. A reorg, wrong pool/amount/output, expired evidence, or RPC disagreement moves the order to unresolved; it never authorizes payout.

### 6. Payout authorization and external signing

Only after canonical source confirmation, separately queue, authorize, and approve the one-time payout. Build the Base packet from the decrypted approved order and the loaded confirmed operator configuration. It binds order/authorization IDs, LP sender plus confirmation timestamp/source, chain `84532`, official token, exact EIP-55 recipient, exact USDC atomic units, ERC-20 `transfer` calldata, value zero, reserved nonce, gas/fee bounds, expiry, serialized unsigned transaction, and digest.

The external signer must independently compare every field, lock `(chain, sender)`, reconcile confirmed/pending nonce, and reserve one unique `(order)` and `(chain, sender, nonce)`. Signing needs a separate human approval; broadcasting needs another. No private key enters the coordinator, Render, Neon, logs, or this repository.

On ambiguous broadcast, locate the exact signed hash and sender nonce. The same signed bytes may be rebroadcast. Any EIP-1559 replacement keeps sender, nonce, chain, token, recipient, amount, value, and calldata identical; only fee fields may increase under a new reviewed packet. Never substitute a sender or allocate a new nonce while the original is unresolved.

### 7. Destination verification and receipt

Record only the externally returned exact hash. After at least three confirmations, independently require a successful canonical Base Sepolia receipt and exactly one official-contract `Transfer` from the configured LP sender to the bound recipient for the exact amount. Reject removed/reorged logs, wrong sender/chain/token/recipient/amount, duplicate hash, nonce conflict, and under/overpayment.

Run `verify-payout` only after that check; it creates the signed linked receipt. Run read-only `verify-receipt` and verify its signature, order/source/destination bindings, canonical evidence, and authenticated owner access. Publish txids or a receipt only after these independent checks; never create fixture evidence that resembles a real transaction.

## Stop conditions and next safe step

Stop on any mismatch, stale tip, incomplete history, unlock outside its approval window, ambiguous wallet/Base response, changed nonce, reorg, duplicate evidence, or expired order/packet. Mark unresolved and preserve the journals.

The next safe executable step is review of the local commit and a clean disposable migration/test run. After that, the owner may separately authorize creation of exactly one real owner-bound request and EIP-712 proof. That approval does not authorize acceptance, receiver allocation, unlock, signing, broadcast, or payout.
