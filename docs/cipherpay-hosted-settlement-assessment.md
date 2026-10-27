# CipherPay hosted settlement assessment

Assessment date: 2026-10-27. Decision: **BLOCKED**.

CipherPay cannot replace Zecori's private watch-only `zecd` verifier without
weakening the accepted settlement invariants. No provider adapter was added.
All route, liquidity and public-settlement flags remain disabled.

No Zecori UFVK, UIVK, wallet secret, API key, webhook secret or transaction was
sent to CipherPay. The only hosted probes were `GET /api/health` (200) and an
invoice request using the deliberately invalid token
`cpay_sk_disposable_invalid_probe` (401). No provider account was created.

## Sources and version boundary

- Hosted documentation and API: [testnet docs](https://testnet.cipherpay.app/en/docs)
  and `https://api.testnet.cipherpay.app/api/health`, checked 2026-10-27.
- Default open-source branch: [`f6f022d`](https://github.com/atmospherelabs-dev/cipherpay-api/commit/f6f022db1f6754b4cd74fea2275f040ec14d557b).
- Newer unmerged audit branch: [`39e4ae3`](https://github.com/atmospherelabs-dev/cipherpay-api/commit/39e4ae36e5d1761fc9460f4cbf6b5bbaa62393e0), six commits ahead of the default branch.
- Ironwood implementation: [`e84ed8e`](https://github.com/atmospherelabs-dev/cipherpay-api/commit/e84ed8ec2d2f48529bcb9474142a7490eed0da24).

The hosted health response contains no build version or commit. It is therefore
not possible to prove which public revision the hosted service runs. The audit
below uses the stricter audit branch where it differs from the default branch.

## Compatibility matrix

| Requirement | Finding | Decision |
| --- | --- | --- |
| Free/no-card access | Testnet docs require registration with a testnet viewing key and then issue an API key, dashboard token and webhook secret. They document free testnet ZEC and show no card-registration step. Hosted production advertises a 1% payment fee; no durable no-card entitlement or SLA is promised. Registration was not attempted because it requires disclosing a viewing key. | **UNVERIFIED**, and not sufficient for launch. |
| Real Ironwood testnet | The source parses NU6.3 transactions and trial-decrypts `IronwoodDomain` outputs. The hosted docs explicitly separate `uviewtest`/`utest` accounts. | **PASS at source level only**; hosted build identity is unknown. |
| Exact receiver/diversifier ownership | CipherPay derives its own Orchard-only receiver from an internal `u32` counter. Its API does not accept Zecori's already-journaled exact receiver/diversifier and does not return the diversifier index in the public invoice object. Zecori instead journals an arbitrary exact decimal index, derives that index through Wallet B, proves `ismine`, Orchard-only consistency, no prior history and a future-height boundary. | **BLOCKED**. Provider-controlled allocation cannot replace Zecori's allocation authority. |
| Empty memo | The current source matches diversified invoices by exact merchant plus decrypted receiver before considering a memo, so a payment to that provider-derived receiver can be detected with an empty memo. The hosted checkout still emits a ZIP-321 URI containing a memo and its docs tell buyers to include it. | **Conditional PASS in source**, but unusable because the receiver invariant fails. |
| Ten canonical confirmations and reorgs | `check_tx_confirmed` accepts one confirmation. The scanner immediately makes `confirmed` durable and emits fulfillment webhooks. It stores no evidence block hash and has no ten-confirmation state or confirmed-to-unresolved rollback. The audit branch rejects an explicit zero-confirmation response but still requires only one. | **BLOCKED**. |
| Signed webhook and replay safety | Deliveries use HMAC-SHA256 over `timestamp.body`, include a delivery ID, retry with a fresh timestamp up to five attempts, and document a five-minute receiver window. The receiver must preserve the raw body, reject future/stale timestamps and durably deduplicate the delivery ID. | **PASS for notification authentication only**. A webhook can never be settlement evidence. |
| Exact independently corroborated evidence | The public invoice object exposes status, txid and aggregate received amount, but not pool, output index, diversifier index, block height/hash/time or canonical-chain proof. Both hosted detection and confirmation depend on CipherScan. Zecori requires exactly one owned, non-change Ironwood output and independently rechecks its canonical block. | **BLOCKED**. |
| Viewing-key confidentiality and least privilege | On registration, the source derives and stores an Orchard external UIVK encrypted with AES-GCM, which is narrower than retaining the UFVK. The hosted operator can still decrypt it, scan every incoming external-scope output, correlate invoice addresses/amounts/txids and retain invoice/delivery history. The hosted service's encryption-key operations, access controls, backups, logs and deletion execution are not independently attested. | **BLOCKED for Zecori's existing privacy boundary**. |
| Missed callbacks and provider outages | Invoice status can be polled; source code persists a scan height, catches up blocks and stores webhook retries, with a dashboard manual retry after terminal failure. This recovers some missed callbacks. It does not provide an independently trustworthy chain view, a documented hosted SLA, a build attestation, or safe reorg recovery after `confirmed`. | **BLOCKED as the sole verifier**. |

The later audit branch also repairs cross-merchant receiver matching and payment
replay/accounting defects that remain in the default branch. That is useful
security work, but an unmerged branch with no hosted build attestation cannot be
treated as the running service.

## Deployment requirements

The present safe deployment remains:

1. Keep the existing free Render Node web service and Neon PostgreSQL database.
   Render receives no viewing key, wallet RPC credential, payout key or CipherPay
   credential. Its filesystem remains disposable; Neon remains the durable,
   pooled TLS store. Do not change `render.yaml` or migrate Neon for this work.
2. Keep `ZECATHON_ROUTE_REQUESTS_ENABLED=0` and
   `ZECATHON_ROUTE_LIQUIDITY_READY=0` until every live gate passes.
3. Source verification still requires a separate, persistent, no-inbound private
   host running the checksum-pinned watch-only `zecd`, durable scan state and the
   outbound signed relay. It needs a separately authorized one-time UIVK/UFVK
   ceremony, encrypted backup/restore, restart and reorg drills, and a known
   Ironwood match/non-match acceptance test. No no-card host satisfying those
   requirements has been verified, so hosted source settlement remains blocked.
4. Preserve distinct coordinator/verifier Ed25519 identities, encrypted relay
   payloads, unique nonces and output replay references. Provider callbacks, if
   ever evaluated again, are advisory input only.
5. Keep Base verification read-only on Render against a trusted HTTPS Base
   Sepolia RPC. Payout signing remains outside Render and outside the verifier.

## Base signer without a developer laptop

**PASS design: manual mobile/hardware signing by the existing EOA.** The existing
LP sender can remain unchanged and use MetaMask Mobile (or a mobile-connected
hardware wallet) on Base Sepolia. A human reviews the exact official test-USDC
contract, immutable recipient, `1,000,000` atomic units, nonce and gas, then
broadcasts once and records the returned hash. The product is continuously
hosted on Render/Neon; a phone is needed only for the separately authorized
payout. No delegated permission, server key, automatic retry or automatic
payout is introduced.

**BLOCKED alternatives:**

- A Safe account provides proposal/confirmation quorums, but changes the payout
  sender to a contract, requires moving test-USDC/gas, and conflicts with the
  current EOA-only/disabled-ERC-1271 gate.
- A hosted signer such as Turnkey supports Base Sepolia and human-consensus
  policies, but importing the existing key or moving assets to a provider-created
  wallet changes the custody/trust boundary and creates a server signing API.
  Its free/no-card durability is also not part of Zecori's accepted deployment.

Neither alternative is approved or implemented.

## One independently verified testnet transfer plan

This is a future approval sequence, not authorization to move funds.

1. Provision the persistent private verifier host and pass its walletless chain,
   watch-only import, full scan, restart, backup/restore, outage and reorg gates.
2. Create one owner-scoped order with the immutable `0.01 TAZ -> 1 test USDC`
   terms and a destination-control proof for the exact Base recipient.
3. Separately authorize one journaled Orchard allocation. Derive and validate that
   exact unused receiver, publish byte-identical instructions, and require an
   empty memo.
4. Separately authorize Wallet A to send exactly `1,000,000` zatoshis once. Record
   its txid; never auto-retry an ambiguous broadcast.
5. Apply signed detection, then wait for ten confirmations and independently
   recheck the exact output, pool, amount, receiver, diversifier, output index,
   allocation height/time and canonical block hash. Any mismatch becomes
   `UNRESOLVED`.
6. Queue payout review and consume the separate short-lived approval. On the
   mobile signer, review and send exactly `1,000,000` atomic official test-USDC
   from the bound LP EOA to the immutable recipient once.
7. After three canonical Base confirmations, verify exactly one matching
   `Transfer` from the bound sender using Zecori's read-only verifier and compare
   the tx/block independently through a second RPC or explorer. Only then create
   the encrypted private receipt and redacted shareable receipt.

Until step 1 has a no-card persistent host, the decision remains **BLOCKED** and
no public settlement claim is permitted.
