# ZECATHON — Original Cross-Chain Prototype (Phase 01)

This is **new application code**, separate from the public Kawase, Noir adapter and Paycrest references. Its purpose is narrow:

1. User clicks to connect the **Noir browser extension**, with the wallet's permission.
2. App shows a **masked shielded Zcash address** and configured Zcash network.
3. User can explicitly request to view their shielded balance (never auto-shown).
4. App reads a **locally imported snapshot** of NEAR 1Click's actual token catalogue.
5. User can search destinations across supported chains and prepare a **non-executable intent draft**.

**Not implemented:** live quotes, any ZEC transfer, shielded receiving provider, cross-chain settlement, refunds, bank payout, voice, languages, or Offramp MCP. The app makes no claim that catalogue-listed assets can currently trade or that a private route exists. There is **no send, approve, or payout button**.

## Phase 02: testnet order coordinator

The app now has a deliberately non-atomic, testnet-only trusted-liquidity-provider coordinator for Zcash testnet TAZ → Base Sepolia Circle test-USDC orders. Its disclosed experimental rate is fixed at 1 TAZ = 100 test USDC and is not a live market quote. Orders carry exact zatoshi and token atomic amounts, immutable terms, expiry, confirmation thresholds, custody/refund disclosures and the explicit Experiment 08 lifecycle. State is persisted atomically with `0600` file / `0700` directory permissions outside the Vite workspace at `${XDG_DATA_HOME:-~/.local/share}/zecathon-crosschain-app/orders.json`.

Read-only adapters accept a transaction ID only as an untrusted lookup candidate. The Zcash adapter derives testnet, sync, lock, ownership, per-output zatoshi amount, direction, mined status, confirmations, canonical block, Ironwood pool, address and optional diversifier identity from Wallet B's loopback RPC. The Base adapter derives chain ID `84532`, receipt success, confirmations, canonical inclusion, the official ERC-20 `Transfer` event, full recipient, exact atomic amount, and the test-USDC contract `0x036CbD53842c5426634e7929541eC2318f3dCF7e` from the configured public read RPC. Receipt IDs are globally indexed to prevent replay across orders.

The independently observed historical Zcash and Base Sepolia transfers are not represented as a completed cross-chain swap. No transfer, signing or payout broadcast is implemented. A one-time manual authorization state exists only to gate later operator-submitted testnet evidence.

This local file-backed endpoint is a development/research coordinator only. It is not production-grade custody, atomic settlement, or a trustless bridge; production use would require a separately deployed authenticated service, durable database, operator controls, and a reviewed reconciliation/refund process.

## Phase 03: history and receipt foundation

`/history` is a transaction-history page, and each order opens a detail page at `/history/:orderId`. Details show fixed terms, disclosures, receipt observations, status, and any final receipt. The coordinator implements CREATED, AWAITING_PAYMENT, SOURCE_DETECTED, SOURCE_CONFIRMED, PAYOUT_AWAITING_APPROVAL, PAYOUT_SUBMITTED, COMPLETED, FAILED, REFUND_PENDING, REFUNDED and UNRESOLVED.

The private receipt model carries the linked evidence for one order. A final receipt requires the same order's independently verified source output and manually authorized, independently verified destination payout. The shareable form removes both transaction IDs, the shielded receiver, internal order/correlation ID, shielded amount, shielded settlement timestamp, transaction fees, source chain and source asset. Print/download is an HTML print-safe layout only and makes no cryptographic PDF-authentication claim.

The browser may submit only a source transaction lookup candidate; all source facts come from Wallet B RPC. Address reservation, payout approval, payout-reference recording and destination verification are operator-only store methods with no browser routes. A browser-supplied destination hash can never complete an order. RPC failures do not mutate state, and historical payments are rejected by the allocation-height boundary or the Base production verifier.

Browser access is localhost-only and owner-scoped by a random HttpOnly, SameSite session cookie. Order lists and receipt responses redact wallet addresses, both transaction IDs, cross-chain linkage, and internal ownership/correlation fields. Vite restricts `/@fs/`, denies order/cookie/key paths, binds to `127.0.0.1`, and does not serve the external database.

## Prerequisites

- Ubuntu with Node.js 24, Corepack/pnpm.
- A pre-cloned and **built** local Noir adapter at `~/Desktop/zecathon/references/noir-adapter` (you passed its 33 tests).
- The NEAR tokens JSON you already downloaded: `~/Desktop/zecathon/experiments/asset-audit/near-tokens.json`.
- Noir extension installed in the **same browser** in which you open `http://127.0.0.1:5173`.

## Install and run

From `~/Desktop/zecathon` extract `zecathon-crosschain-app/` into `product/` and run:

```bash
cd ~/Desktop/zecathon/product/zecathon-crosschain-app
corepack pnpm install --no-frozen-lockfile --ignore-scripts
corepack pnpm import:catalogue
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
# Explicit read-only public Base RPC integration test:
BASE_RPC_LIVE=1 node --experimental-strip-types --test --test-name-pattern='live reference' server/base-sepolia-verifier.test.ts
# Explicit read-only Wallet B / Experiment 03 integration test (never creates an order):
corepack pnpm test:zcash-live
corepack pnpm dev
```

Open http://127.0.0.1:5173 in your browser. Click **Connect Noir Wallet** and approve the site in Noir. Connection does **not** authorize a transaction. Don't enter seed phrases into this website or terminal.

`link:../../references/noir-adapter` intentionally uses **your locally built reference dependency**, not a copy of its code, and requires that directory to remain present. If it isn't already built, build it in its own reference directory first.

If `import:catalogue` fails, check the file exists with `ls -lh ../../experiments/asset-audit/near-tokens.json`. The app deliberately displays an error instead of fabricated tokens.

## Safety and privacy decisions

- No `zcash_sendTransaction` call exists in the app.
- No NEAR quote or swap POST call exists in the app.
- No browser wallet auto-connect. User must click Connect each session.
- Assigned Wallet B receiving addresses are stored only in the private coordinator database and are redacted from browser responses; Noir browser-wallet addresses are not persisted.
- No data submitted to an AI/voice provider.
- No RPC cookie, owner session, wallet address, or private receipt transaction ID is returned in browser JSON or written to application logs.
- Wallet B RPC is hard-coded to loopback (`127.0.0.1:18393`) and uses its cookie only in the server adapter.
- Wallet B must remain locked. Verification refuses an actively unlocked wallet and makes read-only RPC calls only.
- The address allocator exposes only a read-only validation/reservation path. Its documented `z_getaddressforaccount` derivation plan is disabled and requires later explicit operator approval.
- Real wallet address is masked in the interface; note that browser extensions and wallet sync infrastructure still process wallet information.
- Mainnet configured for adapter; **verify Noir's actual network**. Do not use funded wallets for experimental payments.
- The public catalogue JSON contains supported asset metadata, not private user info. Do not copy your quote JSON or bank data into public/.
- Imports external dependencies under their own licenses. Keep hackathon-original product source separate from refs.

## Why Kawase is the reference

Study `references/kawase/packages/policy` (deterministic safety policies), `packages/intents` (immutable approved terms), `apps/api/src/crosschain` (settlement and failure states), and `DESIGN.md` (accessible design system). Do not copy Kawase code or exact UI. We use principles only.

## Acceptance evidence

- 33 tests passed in upstream Noir adapter (reported by developer, not re-executed within this archive).
- Local tests cover source-chain identity, filtering, amount precision, malformed metadata, RPC verification failures, replay protection, owner isolation, browser redaction, and real Vite `/@fs/` denial.
- `corepack pnpm typecheck` and `build` must pass on the developer's machine.
- A real Noir browser-connect test remains outstanding.
- Shielded-to-shielded receiving, cross-chain settlement, privacy audit and actual refunds remain unresolved.

## Experiment 07: live Zcash RPC verification

`LIVE_ZCASH_RPC_VERIFIED` on 2026-10-23. The read-only live test matched the successful historical Experiment 03 journal to exactly one Wallet B incoming, non-change Ironwood output for 1,000,000 zatoshis. The node was on testnet, fully synchronized, canonical and sufficiently confirmed; Wallet B remained encrypted and locked; ownership, output index and diversifier identity agreed across the wallet RPC views. No order, swap, receipt, payment, signature, broadcast, unlock or payout was created. The independent historical Zcash and Base observations remain separate experiments and are not classified as a completed cross-chain swap.

## Experiment 08: linked order preparation

The linked workflow is implemented without funds movement. An operator must later approve derivation of a fresh Orchard-only Unified Address, validate and reserve it through the server, manually approve any payout, submit that payout outside this application, and invoke independent Base verification. Until those actions occur, no genuine linked order can progress through settlement. Historical Experiment 03 and the historical Base reference remain permanently ineligible as a linked order pair.

## Experiment 08B: operator control and preflight

The local operator CLI is invoked with `corepack pnpm operator -- <command>`. Read-only commands are `wallet-health`, `base-health`, `balances`, `orders`, `preview`, `preflight` and `readiness`. They inspect Wallet B, Base Sepolia, LP test-token/gas balances, private coordinator state, crash-recovery records and the proposed 0.01 TAZ → 1 test-USDC terms. `preview` requires the Base recipient twice (`--recipient` and `--confirm-recipient`) so no historical address is inferred.

Authorization commands require an interactive terminal, `ZECATHON_OPERATOR_ID`, an independently provisioned operator key at `${XDG_DATA_HOME:-~/.local/share}/zecathon-crosschain-app/operator.key`, exact confirmation text, a signed action scope and a 15-minute expiry. The key must contain at least 32 random bytes and have mode `0600`; the containing directory must be `0700`. Preflight never creates this key or any database file.

Future address allocation precommits an exact decimal 88-bit diversifier to an fsync-backed journal before the guarded `z_getaddressforaccount` call. A crash before the response retries the same deterministic index; a crash after derivation resumes from the recorded address; a crash after database reservation treats the reservation idempotently. Arbitrary-precision RPC integers are serialized and parsed without JavaScript `Number` conversion. The safety gate permits that RPC only in the authorization-checked operator action module, and browser routes cannot reach it.

No CLI command signs or broadcasts a transaction. Payout authorization changes coordinator approval state only; submission remains an external manual testnet action, and completion still requires the existing Base RPC verifier. Late payments, unsuccessful payouts, uncertain broadcasts and refunds remain manual reconciliation states. Refunds are neither automatic nor guaranteed.

## Experiment 08C: operator bootstrap

Run the account setup only in a private interactive terminal. Select **Base Sepolia** in MetaMask, copy the full LP Sender and USDC Receiver public addresses, and do not enter a private key or recovery phrase:

```bash
corepack pnpm operator -- configure
corepack pnpm operator -- bootstrap
corepack pnpm operator -- status
```

`configure` prompts for two distinct complete `0x` addresses and exact confirmation of Base Sepolia chain ID `84532`. It creates `${XDG_DATA_HOME:-~/.local/share}/zecathon-crosschain-app/operator-config.json` with mode `0600` in a mode-`0700` directory. It never reads historical transaction screenshots or evidence, accepts no wallet secret, and refuses to overwrite an existing configuration.

`bootstrap` requires the stored account configuration plus the exact interactive phrase `INITIALIZE PRIVATE OPERATOR STORAGE`. It initializes an empty `orders.json`, an empty `operator-control.json`, and a separate random 32-byte `operator.key`. All files use durable writes and private permissions outside the application workspace. Existing files and credentials are preserved rather than overwritten, and the key is never printed.

After bootstrap, these commands are read-only:

```bash
corepack pnpm operator -- wallet-health
corepack pnpm operator -- base-health
corepack pnpm operator -- balances
corepack pnpm operator -- readiness
corepack pnpm operator -- preview
corepack pnpm operator -- preflight
```

`readiness` may reach `OPERATOR_CONFIGURED` without a Zcash receiving allocation. `preflight` remains a stricter first-payment gate and must continue to report that a fresh Orchard address is absent during Experiment 08C. Neither command derives an address, creates an order, unlocks a wallet, signs, broadcasts, or authorizes a payout.

Back up the entire private `zecathon-crosschain-app` data directory using encrypted offline storage while the operator is stopped. Treat the files as one recovery unit: losing `operator.key` invalidates existing local authorizations, and losing either database destroys local reconciliation state. There is no seed phrase or automatic recovery. Never regenerate or replace a missing key beside an existing control database; restore the matched backup or begin a separately reviewed clean experiment.

## Experiment 08D: signed first-order workflow

Order lifecycle mutations are now operator-CLI-only. The browser keeps redacted history and receipt observation, but `POST /api/orders` and browser activation are refused. The mainnet Noir adapter remains read-only inspection UI and is never accepted as a testnet funding wallet.

The future operator sequence is:

```bash
export ZECATHON_OPERATOR_ID='<local-operator-id>'
corepack pnpm operator -- configure-source-wallet --rpc 'http://127.0.0.1:18392/' --data-dir '/absolute/path/to/existing/zecd-testnet-data' --confirm 'CONFIGURE EXISTING TESTNET WALLET A'
corepack pnpm operator -- source-wallet
corepack pnpm operator -- prepare-order --expiry-minutes 30 --confirm 'PREPARE UNIQUE TESTNET ORDER'
corepack pnpm operator -- authorize-address --order '<order-id>' --confirm 'AUTHORIZE FRESH ORCHARD ADDRESS'
corepack pnpm operator -- recover-address --order '<order-id>' --authorization '<authorization-id>' --confirm 'EXECUTE AUTHORIZED ADDRESS ALLOCATION'
corepack pnpm operator -- preflight
corepack pnpm operator -- activate-order --order '<order-id>' --confirm 'ACTIVATE TESTNET PAYMENT INSTRUCTIONS'
```

`prepare-order` uses only the stored operator-confirmed Base recipient and the registered route-provider definition. It creates an HMAC-signed immutable manifest binding the unique order ID, provider, `1,000,000` source zatoshis, `1,000,000` destination atomic units, Base recipient, token contract, networks and expiry. It does not allocate an address or activate payment.

`authorize-address` binds its one-time authorization and precommitted diversifier to that exact manifest. `recover-address` journals `DERIVATION_PENDING` before the only guarded `z_getaddressforaccount` call, validates ownership and Orchard-only shape, rejects address/diversifier history, and atomically binds the allocation to that order. Interrupted `IN_PROGRESS` work can resume with the same authorization after its issue-time expiry; an expired authorization that never began is revoked when replaced. A recovery that completes after order expiry records a failed, non-payable order instead of exposing instructions.

`activate-order` rechecks strict Wallet B/Base/liquidity preflight and then reads Wallet A account `0` through its own loopback RPC. Wallet A must be Zcash testnet, synchronized, history-complete, encrypted and locked, with at least 10-confirmation balance covering `1,000,000` zatoshis plus a `10,000`-zatoshi fee reserve. Only successful activation prints the full testnet payment receiver in the private operator terminal.

Wallet A has no guessed path or environment fallback. `configure-source-wallet` must explicitly bind the existing private data directory to `http://127.0.0.1:18392/` in a separate mode-`0600` operator configuration file. It validates the existing mode-`0700` directory and mode-`0600` keys file without reading key contents, stores no RPC cookie, refuses symlinks and overwrites, and rejects Wallet B's path and port. `source-wallet` reads the runtime cookie directly from that explicitly configured directory only while the daemon is running.

Route providers are registered in code with named independent source and destination verifiers. Adding a provider requires a registered definition and causes its provider ID to be covered by the immutable order signature; an arbitrary provider ID is rejected.
