# Noir SDK testnet wallet connection evidence

Status: connection and private local readiness implemented; transaction sending and public promotion disabled.

## Exact compatibility evidence

- Application dependency: `@noir-wallet/sdk` `0.1.9`, npm integrity `sha512-VLoRYh3Omzz7GJphZootFzirhx4+RAtiur2iLj3sZVWOMHMifU/RR9Czc1oepqRJLPO940iypq1ma/5rbdJ08Q==`.
- Reviewed extension release: `v1.0.40-beta.local.20261024101618.bf99d98`; wallet source commit `bf99d98030c7df7e844f64c660b589d5ab7c6019`.
- Official testnet asset: `noir-wallet-v1.0.40-beta.local.20261024101618.bf99d98-testnet.zip`, 58,344,532 bytes, SHA-256 `e4fdfd9702cd1252b1e40d888952e12bcf7a9caaa4ad103380839aea54d7897b`. The downloaded digest matched both `SHA256SUMS` and the GitHub release API digest.
- Manifest evidence: MV3, name `[Testnet] Noir Wallet`, version `1.0.40`.
- Provider evidence: the packaged main-world injector exposes only frozen `{ isNoirWallet: true, version: "1.0.40", zcash }` and the `noirwallet#initialized` event. It does not expose the manifest name, extension ID, network, asset digest, or pool.
- Ironwood evidence: the testnet artifact contains Ironwood activation, balance, transaction, WASM, and hardware-signing code. That proves code is present in the inspected artifact; it does not let a web origin prove that this artifact, rather than the same-version mainnet artifact, supplied the provider or that an authorized balance is Ironwood.

Consequently `1.0.40` is accepted as API-version compatibility evidence, not as network attestation. Zecori never infers testnet or Ironwood from transparent or shielded address text.

## Implemented browser behavior

- Detect the injected wallet with the official SDK.
- At startup call silent `getAccounts()` only. `null` means no prior authorization; no consent window opens.
- From an explicit Connect click call `connect()`, then read `getBalance(account.id)` only for an authorized account.
- Keep account and balance data in React memory only. The UI hides addresses and shows only the wallet label, authorized count, shielded, available, pending, synchronization and conservative sufficiency state.
- Subscribe to `accountsChanged`, invalidate immediately, and refresh with `getAccounts()` rather than trusting cached state.
- Expire readiness after 30 seconds.
- Reject missing extension, rejected consent, malformed data, unsynchronized balance, non-1.0.40 builds, insufficient shielded/available amounts, and unverifiable network/pool configuration.
- Preserve manual shielded-source instructions, connected Base Sepolia checks, manual Base recipient validation, and destination-control proof behavior.

Browser evidence captured under `artifacts/noir-wallet-connection/` includes desktop and mobile Noir wallet readiness plus the existing landing, route, documentation, account, and inbox surfaces. The mocked browser acceptance exercises explicit consent, authorized balance inspection, hidden addresses, Base/manual-recipient preservation, and absence of send controls. A separate real-extension smoke used the exact checksum-verified testnet artifact in a disposable Chrome-for-Testing profile; it detected provider v1.0.40, called only `zcash_getAccounts`, and returned the expected locked state without creating or authorizing a wallet.

## Payment confirmation boundary

`prepareNoirPaymentConfirmation()` is review-only. It accepts only a currently actionable `PAYMENT_READY` request and binds:

- order ID and fixed route ID;
- exact `0.01` TAZ / `1,000,000` zatoshi source amount;
- dedicated shielded receiver and exact order expiry;
- Ironwood/testnet source terms;
- Base Sepolia chain, USDC amount, exact recipient and provider ID;
- a future SDK request with `fundingSource: "shielded"`.

Transparent funding, stale instructions, missing receiver, or term/expiry mismatch throw before a request can be prepared. There is no execution function and the consumer control is disabled.

## Remaining acceptance gaps

1. Noir must expose a reviewed, origin-verifiable build/network identity and Ironwood-specific spendable capability, or Zecori needs an equally trustworthy independently reviewed attestation channel. Version and address shape are insufficient.
2. Test an authorized, newly created test-only wallet in a disposable Chrome-for-Testing profile: consent rejection, unlock/lock, multi-account switching, restart, balance sync, and account removal. No existing profile, seed, or funded wallet may be reused.
3. Add a dedicated receiver to an authorized immutable order and use `getMaxTransfer({ to, fundingSource: "shielded" })` to prove exact shielded spendability and fees before enabling any send control.
4. Obtain separate security and product review of the payment confirmation and wallet approval handoff.
5. Only after those gates pass, explicitly authorize one funded end-to-end test using test assets and independent Ironwood source verification. Route and liquidity flags remain off until that ceremony.

No seed, spending key, viewing key, wallet database, real ZEC, transaction signature, broadcast, Neon data, Render flag, deployment, or public route was touched by this implementation.
