# Milestone 07A release candidate and real-wallet readiness

Status: `RELEASE_CANDIDATE_READY` after the evidence fields in the verification audit are filled from the committed candidate build. This milestone does not authorize deployment, durable-database migration, wallet access, signing, allocation, funding, payout, or a linked transaction.

## Release boundary

The candidate must be built from a clean committed tree exported with `git archive`, never from the working directory. The Docker build requires `VCS_REF` to be the exact 40-character source revision and records it as `org.opencontainers.image.revision`. Record the local image ID, OCI manifest digest, base-image identity, migration hashes, dependency inventory, and scan evidence in the verification audit. Do not push the tag or deploy it.

Image inspection must establish all of the following before the candidate is retained:

- no `.env` files, deployment secrets, private/operator data, wallet database extensions, cookies, keyrings, PEM private keys, seed or mnemonic files;
- no API keys, bearer tokens, viewing keys, operator credentials, real recipient records, or private receipts in files or image history;
- runtime runs as UID/GID 10001, uses a read-only filesystem in Compose, and receives credentials only through runtime secret mounts;
- embedded migrations 001–008 exactly match the committed source hashes.

## Migration and recovery decision

Migration 007 preserves pre-existing destinations only as `legacy_destination_recipient`, marks those rows binding version 1, and gives them no owner. Such rows cannot satisfy the version-2 owner/intent/proof joins and must never be accepted, allocated, or paid. Migration 008 adds single-use encrypted challenges, immutable proofs, replay constraints, and append-only wallet audit events. It does not reinterpret an old passkey, request, or session as wallet-control evidence.

The upgrade procedure is forward-only. Schema rollback is not considered safe after version-2 records exist. Before durable staging is touched, the operator must retain the prior image digest, stop financial activity, take an authenticated encrypted backup, verify checksums and the source keyring canary, restore the complete backup into an isolated PostgreSQL instance, restart that instance, and compare migrations plus encrypted-record/audit/replay inventory. Recovery means restoring the complete pre-migration database and prior image under a separately approved incident procedure. Never attempt a column-level down migration of 007 or delete 008 evidence.

## Human-controlled browser runbook

Use a reviewed HTTPS staging origin and an approved Base Sepolia RPC. Record timestamps, candidate image digest, browser/wallet versions, public account IDs, challenge IDs, request IDs, recovered public signer address, chain ID, and redacted screenshots. Do not record passkey material, raw signatures, nonces, full typed data, cookies, or private correlation evidence.

1. Confirm the capability response says `required-eip712-eoa`, lists only `EIP-712 EOA`, and reports contract wallets `disabled-until-live-validation`.
2. In Browser Profile A, create Account A with a real platform passkey. Sign out, sign in with that passkey, and confirm the same empty private history returns.
3. In an independent Browser Profile B, create Account B with a different real passkey. Confirm neither profile can read the other account's request ID (404, with no existence leak).
4. In Profile A, select the exact fixed route: 0.01 TAZ from Zcash testnet Ironwood to 1 test USDC on Base Sepolia 84532. Connect one real EOA only after the visible user click.
5. Reject a connection/signature once and confirm no request is verified, no payment instructions appear, and retry requires another click.
6. Switch the wallet to a wrong chain and confirm rejection. Return to Base Sepolia, connect the intended EOA, review the EIP-712 domain and message, then explicitly approve the destination-control signature.
7. Confirm the message purpose says it proves destination control only and does not authorize payment, payout, token allowance, ERC-20 approval, or a transaction. Confirm there is no `spender`, allowance, transfer, value, calldata, or transaction request.
8. Independently recover the signer from the returned EIP-712 digest/signature in a temporary operator tool without persisting the raw signature. It must exactly equal the immutable recipient and the server result must be `eip712-eoa`.
9. Resubmit the same challenge/signature and confirm single-use rejection. Attempt the challenge from Profile B and confirm owner/session rejection.
10. Switch accounts in the wallet and confirm the UI clears readiness/consent. A signature by the wrong account must be rejected and must not change the destination.
11. Attempt to create a conflicting destination for Account A and confirm 409. Confirm Account B can bind only its own independently verified recipient.
12. Sign out and back in to Account A and confirm the verified request and exact redacted state recover. Restart only the candidate API, not PostgreSQL, then repeat the recovery check.
13. Confirm an operator listing shows only the EOA-proved request. Do not accept it during this browser run. Confirm no shielded payment receiver or Zcash instructions exist.

Every wallet signature requires a visible user gesture and wallet confirmation. Automation may prepare typed data and observe the result, but must never approve the wallet prompt.

## ERC-1271 policy

ERC-1271 remains implemented and fixture-tested, but the first release is EOA-only because no deployed Base Sepolia contract wallet has completed the live browser and checkpoint sequence. `ZECATHON_ERC1271_ENABLED=0` is explicit in production and staging Compose. Missing, empty, or `0` configuration disables contract wallets; any value except exact `0` or `1` fails startup. When disabled, contract recipients fail verification, existing ERC-1271 proofs are omitted from the pending queue, and operator acceptance/accepted-order/payout checkpoints reject them.

Enabling `1` requires a separate approved release after a deployed wallet proves initial ERC-1271 validation, changed/revoked validity, canonical pinned-block RPC behavior, acceptance recheck, and payout-authorization recheck. Until then, contract-wallet support must not be described as production ready.

## First linked-test approval packet

The future test is exactly 0.01 TAZ from Zcash testnet Ironwood only to 1 test USDC on Base Sepolia 84532 for the owner-specific EOA recipient committed into the order, using the experimental trusted liquidity provider. The agent has no allocation, signing, payment, payout, or broadcast tools.

Before a GO decision, require all of the following evidence tied to the candidate digest:

- successful human runbook above for two accounts and one real EOA;
- fresh authenticated durable-staging backup plus isolated restore/restart inventory comparison;
- approved HTTPS origin/RP ID and trusted Base Sepolia and Zcash read-only endpoints;
- source wallet independently proven locked/watch-only, testnet, synced, and funded with at least 0.01 TAZ plus fees in safe confirmed Ironwood notes;
- destination test-USDC/gas liquidity and independent Base receipt verifier readiness;
- explicit, separate approvals for deploy/migrate, backup custody, wallet access, allocation, funding, request acceptance, and payout;
- payment instructions withheld until a durable exact-index allocation is authorized, journaled, derived, validated, reserved, and activated;
- final receipt withheld until independently verified same-order source evidence and exact recipient/token/amount destination evidence exist.

There is no operator fixed-recipient fallback. A payment can never settle against another owner's destination. A linked-test decision remains NO-GO until every prerequisite has human evidence.
