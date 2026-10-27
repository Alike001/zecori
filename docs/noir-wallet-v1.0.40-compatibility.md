# Noir Wallet v1.0.40 compatibility assessment

Assessment date: 2026-10-27
Disposition: **SDK CONNECTION IMPLEMENTED / SENDING DISABLED**
Financial status: **first linked swap remains NO-GO**

## Primary sources reviewed

- [Maintainer release: v1.0.40-beta.local.20261024101618.bf99d98](https://github.com/NoirWallet/noir-wallet-sdk/releases/tag/v1.0.40-beta.local.20261024101618.bf99d98)
- [Noir Wallet SDK integration](https://docs.zknoir.com/noir-sdk-integration/)
- [Provider API](https://docs.zknoir.com/developers/provider-api/)
- [Accounts and events](https://docs.zknoir.com/developers/accounts-and-events/)
- [Integration security](https://docs.zknoir.com/developers/security/)
- Archived public SDK source at commit `1677b56` in [`NoirWallet/noir-wallet-sdk`](https://github.com/NoirWallet/noir-wallet-sdk)

The SDK repository is archived and read-only as of 2026-10-26. Its release page states that the attached extension files are byte-for-byte mirrors and that GitHub-generated source archives contain SDK source, not the wallet extension source. An extension ZIP must therefore be treated as a binary distribution and verified against the release checksum before use.

## Release changes relevant to Zecori

The latest v1.0.40 beta source reference is `bf99d98030c7df7e844f64c660b589d5ab7c6019`.

- Full quoted recipients are shown on Review Quote; long addresses remain readable while Confirm remains available. This aligns with Zecori's exact-recipient review requirement but is not independent acceptance evidence.
- Recovery words stay outside readable page content and the accessibility tree until deliberate reveal.
- Queued synchronization respects transaction pauses before work starts and between stages.
- Wallet cleanup, dApp approvals, and response timeouts were hardened.
- The release reports successful TypeScript checks, 605 core tests, WASM integrity, ZIP validation, and an isolated MV3 recipient-review check. That check used an intercepted quote and did not execute a live swap.

Known limits remain: cross-restart transaction recovery and automatic resend are excluded, and a funded Shield Funds stall has not been fully reproduced or verified as resolved.

## Zecori compatibility result

Noir's documented startup-safe method is `getAccounts()`, mapped to raw RPC `zcash_getAccounts`. Provider detection and this silent call do not open account approval. Zecori now calls `connect()` / `zcash_requestAccounts` only from a deliberate Connect click and then reads `getBalance(account.id)` for authorized account readiness. Address enumeration, max-transfer, signing, shielding, disconnect, and transaction methods remain excluded.

The v1 account result provides transparent/shielded addresses and authorized account metadata. It does **not** attest the installed extension's network build or an Ironwood source-pool capability. Noir distributes separate mainnet and testnet extensions and deprecates runtime switching. Zecori therefore cannot safely translate a successful silent account response into its stricter `zcash-testnet` + `ironwood` + `readOnly` capability contract.

Implementation evidence:

- `src/lib/noir-wallet-readonly.ts` uses the official SDK, restores only prior authorization silently, requests consent interactively, classifies shielded/available/pending balance in browser memory, invalidates account changes and stale state, and always remains not-ready until build/network and pool attestation are reviewed.
- `src/lib/noir-wallet-readonly.test.ts` proves detection, missing extension, rejected authorization, wrong build, insufficient funds, wallet switching, stale readiness, and the absence of address, signing, shielding, transaction, and disconnect calls.
- `src/lib/noir-payment-confirmation.ts` prepares but cannot execute an exact, expiring, immutable-order-bound future request and rejects transparent funding.
- `scripts/noir-wallet-isolated-smoke.mjs` creates a fresh temporary Chrome profile, refuses non-loopback Zecori URLs, requires an explicitly Testnet manifest at version 1.0.40, calls only `zcash_getAccounts`, and deletes the temporary profile.

The official testnet ZIP was downloaded from the maintainer release and matched its published SHA-256 `e4fdfd9702cd1252b1e40d888952e12bcf7a9caaa4ad103380839aea54d7897b`. The isolated smoke passed with Chrome for Testing in a fresh disposable profile: provider v1.0.40 was detected and the only requested method was `zcash_getAccounts`. The untouched profile reported `Wallet not unlocked`, which the harness records as an expected locked state rather than authorization. The profile was deleted; no wallet was created, unlocked, funded, or altered.

## Safe future acceptance procedure

1. Download the official asset ending in `-testnet.zip` plus `SHA256SUMS` from the maintainer release.
2. Compare the ZIP checksum before extraction. Do not use a message attachment, third-party mirror, or GitHub-generated source archive.
3. Load the unpacked extension only into a newly created disposable Chrome profile.
4. If account-state coverage is required, create a new unfunded test-only wallet. Never import an existing recovery phrase, copy an existing browser profile, or use real ZEC.
5. Start a loopback-only disposable Zecori environment and run:

   ```sh
   NOIR_TESTNET_EXTENSION_DIR='/absolute/path/to/reviewed-unpacked-testnet-extension' \
   pnpm test:noir-wallet:isolated -- http://127.0.0.1:8787/swap
   ```

6. Confirm the emitted method ledger is exactly `zcash_getAccounts`. Do not approve Send, Shield Funds, Swap, message signing, or transactions.
7. Delete the disposable Chrome profile and test-only wallet material after capturing non-secret evidence.
