# First linked testnet transaction readiness

This is a future approval sequence, not authorization to run it. Commands containing wallet start, address derivation, signing or broadcast are deliberately marked `APPROVAL REQUIRED` and were not executed in milestone 03.

## Current findings

- Wallet A configuration validation accepts only an existing mode-`0700`, non-symlink data directory with mode-`0600` `default/keys.toml`, testnet loopback RPC at exactly `127.0.0.1:18392`, and never Wallet B's path.
- The Wallet A health check is read-only: `getblockchaininfo`, `getwalletinfo`, and `z_getbalanceforaccount 0 10`. It requires testnet sync, complete enhanced history, an encrypted locked wallet, exactly ten-confirmation balance policy, and at least `1,010,000` zatoshis (`1,000,000` payment plus `10,000` fee reserve).
- The active PostgreSQL operator CLI can validate and reserve an already-existing Wallet B Orchard address but intentionally does not derive one.
- No command in this milestone signs or broadcasts Zcash or Base transactions. The payout transaction must be created outside this application after a separate approval; the app records and verifies its hash only.

## Approval sequence and exact command shapes

Set private environment variables in an operator-only shell without putting secrets in history. Replace every angle-bracket placeholder and review the expanded command before execution.

1. **Approve Wallet A configuration and start.** First validate/create the local application reference to the existing wallet. The legacy helper is disabled, so use a reviewed one-shot configuration utility or re-enable only that non-wallet mutation in a separate change. Then, only after approval, start the exact pinned binary with its existing Wallet A testnet config:

   ```bash
   # APPROVAL REQUIRED — starts the existing spending wallet; do not run in milestone 03.
   ../../experiments/shielded-receiver/zecd-nu7/zecd-0.9.0-rc2-linux-amd64/zecd \
     --testnet --datadir '<ABSOLUTE_WALLET_A_DATA>' --rpcbind 127.0.0.1 --rpcport 18392 run
   ```

   Confirm the configuration contains an RPC allowlist and the wallet starts locked. Do not pass a mnemonic, identity, passphrase or RPC password on the command line.

2. **Approve the read-only funding check.** No unlock is needed:

   ```bash
   # Read-only after Wallet A is configured and running.
   node --experimental-strip-types -e "import('./server/zcash-source-wallet.ts').then(async m => console.log(JSON.stringify(await m.checkSourceWalletA(), null, 2)))"
   ```

   Require `sufficientForPaymentAndFeeReserve: true`, `confirmedZatoshis >= 1010000`, `locked: true`, complete history and testnet sync.

3. **Create the accepted, inactive linked order identity.** The order-scoped allocation design requires the public request and accepted order UUID to exist before any Wallet B derivation is authorized. A public browser creates the request; the operator then runs:

   ```bash
   corepack pnpm operator -- accept-request --request '<REQUEST_UUID>' --recipient '<EXACT_BASE_RECIPIENT>' --terms '0.01 TAZ -> 1 test USDC' --operator '<OPERATOR_ID>' --confirm 'EXECUTE ACCEPT-REQUEST'
   ```

   This accepts and signs immutable terms but publishes no payment instructions.

4. **Approve exactly one new Wallet B address, then activate the order.** The production CLI first creates a scoped PostgreSQL authorization:

   ```bash
   corepack pnpm operator -- authorize-allocation --order '<ORDER_UUID>' --operator '<OPERATOR_ID>' --confirm 'EXECUTE AUTHORIZE-ALLOCATION'
   ```

   Then, under a separate explicit approval, derive one Orchard address at a pre-journaled diversifier index through Wallet B loopback RPC. This derivation command is intentionally not exposed by the production application yet; implementing the crash-safe PostgreSQL derivation bridge is a blocker. Do not substitute `getnewaddress` or an unjournaled manual call. Finally validate/reserve the returned existing receiver:

   ```bash
   corepack pnpm operator -- reserve-validated-allocation --order '<ORDER_UUID>' --authorization '<AUTH_UUID>' --receiver '<FULL_UTEST_RECEIVER>' --operator '<OPERATOR_ID>' --confirm 'EXECUTE RESERVE-VALIDATED-ALLOCATION'
   ```

   After the validated receiver is durably reserved and all readiness checks pass, publication is the activation point:

   ```bash
   corepack pnpm operator -- publish-instructions --order '<ORDER_UUID>' --operator '<OPERATOR_ID>' --confirm 'EXECUTE PUBLISH-INSTRUCTIONS'
   ```

5. **Authorize the source payment separately.** The application has no send command. After reviewing the active order, exact receiver, amount `1,000,000` zatoshis, fee and expiry, approve a separate Wallet A signing/broadcast procedure. That procedure does not exist in this repository and is a blocker. Never unlock from the web service or relay.

6. **Verify source settlement.** Queue a signed `SOURCE_DETECTION` relay job for the exact txid, let the operator-side worker claim and answer it over the approved mutually authenticated database tunnel, then apply its signed result. Repeat with `SOURCE_CONFIRMATION` at ten confirmations:

   ```bash
   corepack pnpm operator -- relay-source-detect --order '<ORDER_UUID>' --tx '<64_HEX_ZCASH_TXID>' --verifier '<VERIFIER_ID>' --confirm 'EXECUTE RELAY-SOURCE-DETECT'
   corepack pnpm verifier:relay
   corepack pnpm operator -- relay-apply --job '<DETECTION_JOB_UUID>' --verifier '<VERIFIER_ID>' --confirm 'EXECUTE RELAY-APPLY'
   corepack pnpm operator -- relay-source-confirm --order '<ORDER_UUID>' --tx '<64_HEX_ZCASH_TXID>' --verifier '<VERIFIER_ID>' --confirm 'EXECUTE RELAY-SOURCE-CONFIRM'
   corepack pnpm verifier:relay
   corepack pnpm operator -- relay-apply --job '<CONFIRMATION_JOB_UUID>' --verifier '<VERIFIER_ID>' --confirm 'EXECUTE RELAY-APPLY'
   ```

   In production, both processes require PostgreSQL `sslmode=verify-full`, distinct client certificates and CA roots. The coordinator additionally receives only its private signing key and the verifier public key; the operator worker receives only its private signing key and the coordinator public key. Direct `observe-source`/`confirm-source` remain operator-host fallback diagnostics and are not the launch path.

7. **Authorize the Base payout separately.** Queue review, issue a short-lived authorization, then consume it. These commands do not send funds:

   ```bash
   corepack pnpm operator -- queue-payout --order '<ORDER_UUID>' --operator '<OPERATOR_ID>' --confirm 'EXECUTE QUEUE-PAYOUT'
   corepack pnpm operator -- authorize-payout --order '<ORDER_UUID>' --operator '<OPERATOR_ID>' --confirm 'EXECUTE AUTHORIZE-PAYOUT'
   corepack pnpm operator -- approve-payout --order '<ORDER_UUID>' --authorization '<AUTH_UUID>' --operator '<OPERATOR_ID>' --confirm 'EXECUTE APPROVE-PAYOUT'
   ```

   A separately approved external signer submits exactly `1,000,000` atomic test-USDC on Base Sepolia to the immutable recipient. No payout signer exists in this repository.

8. **Verify destination and final receipt.** Record only the externally returned hash, verify canonical Base settlement, then authenticate the receipt:

   ```bash
   corepack pnpm operator -- record-payout --order '<ORDER_UUID>' --tx '<0x_BASE_TX_HASH>' --operator '<OPERATOR_ID>' --confirm 'EXECUTE RECORD-PAYOUT'
   corepack pnpm operator -- verify-payout --order '<ORDER_UUID>' --confirm 'EXECUTE VERIFY-PAYOUT'
   corepack pnpm operator -- verify-receipt --receipt '<RECEIPT_UUID>'
   ```

Stop immediately on RPC ambiguity, reorg, stale/forged relay evidence, insufficient funds, recipient mismatch, expired authorization or restart inconsistency. Mark the order `UNRESOLVED`; never retry a potentially broadcast payment automatically.
