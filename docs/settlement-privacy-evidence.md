# Settlement privacy and chain evidence

Status: implementation evidence for the disabled Zcash testnet Ironwood → Base Sepolia test-USDC route. This document does not claim a linked settlement.

## Data boundary

| Observer | Data available by design | Data withheld by Zecori |
|---|---|---|
| Public Zcash chain observer | A shielded transaction occurred, with the normal network-level timing metadata | Receiver, shielded amount, memo plaintext and the payment's order association |
| Receiving operator / Wallet B verifier | Dedicated receiver, diversifier identity, source txid, output index, exact amount, confirmations, block/time, and any memo the sender supplies | Spending key and seed phrase; Zecori never requests either |
| Zecori server and PostgreSQL | Owner/request binding, encrypted destination intent, encrypted receiver and settlement evidence, hashed replay references, coarse audit state | Decrypted evidence in public views or append-only audit details |
| Optional AI provider | Static route facts and owner-authorized redacted status/receipt fields | Addresses, txids, memos, private notes, raw order records, signatures and settlement evidence |
| Public Base chain observer | Payout sender/recipient, token contract, amount, tx hash, block and timing | The Zcash receiver and source txid unless the operator or user discloses the correlation |
| Shareable receipt reader | Receipt reference, destination network/asset and independent-verification status | Both txids, receiver, internal order ID, both exact settlement amounts, both timestamps, source chain/asset and known fees |

The operator can correlate the private order, its dedicated shielded deposit and the public payout. Amount and timing can also support correlation outside Zecori. This is operator-assisted custody, not an atomic or trustless bridge and not end-to-end anonymity.

## Source-path checks

- Address allocation journals one exact diversifier before the only derivation call, validates an owned Orchard-only Unified Address, rejects prior address history, and binds the receiver to one immutable order.
- Source verification is read-only. It accepts only one mined incoming non-change, non-outgoing `ironwood` output matching the order's receiver, diversifier, exact zatoshi amount, minimum height/time, canonical block and confirmation threshold.
- Wallet A readiness counts only sufficiently confirmed, safe, spendable Ironwood notes. Transparent, Sapling and Orchard balances cannot satisfy the FullPrivacy funding gate.
- Payment instructions require no memo. A sender-supplied shielded memo is readable by the receiver/operator and must not contain a handle, identity, note or destination address. The current verifier does not claim it can prove the absence of a memo from the pinned wallet history response.
- Wallet B may verify with a scoped watch-only wallet or a locked spending wallet. The current allocator itself requires the dedicated Wallet B spending wallet while locked; that wallet can see its own full incoming history, so it must not be shared with unrelated activity.

## Evidence status

| Check | Status | Evidence / remaining gate |
|---|---|---|
| Exact unused Orchard receiver allocation | READY in code | Unit/integration tests; real derivation still needs separate authorization |
| Ironwood output and canonical Zcash block verification | READY in code | Fixture and signed-relay tests; first linked live source output NOT TESTED |
| Signed private source-verification relay | READY in code | Challenge/evidence signatures, expiry and exact request/manifest bindings tested |
| Base Sepolia chain identity and official test-USDC contract | READ-ONLY CHECKED | Public RPC returned chain 84532 and contract code on 2026-10-27 |
| Exact canonical ERC-20 sender/recipient/amount event | READY in code | Production verification requires the operator-confirmed LP sender; unit and historical-reference coverage pass; first linked payout NOT TESTED |
| Operator liquidity and gas | BLOCKED | Approved LP address and a current balance check are required |
| Linked 0.01 TAZ → 1 test USDC settlement | NOT TESTED | Requires new source and payout transactions for the same immutable order |

Public route flags remain disabled until current operator, liquidity and terms-readiness gates are independently satisfied.
