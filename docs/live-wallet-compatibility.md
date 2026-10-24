# Live wallet compatibility readiness

Status: **LIVE_WALLET_STARTUP_READY**. This status means the pinned commands and read-only compatibility gates are ready for a separately approved wallet start. Neither wallet was started, unlocked, modified, or queried during this milestone.

## Pinned implementation audit

The installed binary reports `zecd 0.9.0-rc2` and has SHA-256 `9829f8aa984a77ca937dab878994023e7cb650ac493ec642edf19e9b585011e1`. The exact upstream tag `v0.9.0-rc2` resolves to commit `56e809fb4a3abf122505a28163321149a8823413`.

The pinned dispatch table contains all read-only Wallet A and Wallet B methods used by the application: `getblockchaininfo`, `getwalletinfo`, `getbalance`, `listunspent`, `getaddressinfo`, `gettransaction`, `getblockhash`, and `z_listtransactions`. It also contains the single guarded mutating allocator method, `z_getaddressforaccount`. It does **not** contain `z_getbalanceforaccount`.

`z_getaddressforaccount` accepts account `0`, one receiver-type list, and an exact diversifier index. The allocator submits `[0, ["orchard"], exact_index]`, then requires the response to repeat account `0`, the exact index, and exactly one Orchard receiver. In this zecd release, Ironwood payments use an Orchard receiver; `ironwood` is a transaction pool, not an address receiver type.

## Source funding proof

Wallet A readiness now requires all of the following:

- Zcash testnet, initial block download false, and equal integer block/header tips.
- Configured wallet name `default`, `private_keys_enabled: true`, and account `0` under zecd's one-account wallet model.
- No scan or import error, enhanced history through the current tip, and `unlocked_until: 0`.
- `getbalance "*" 10` aggregate value at or above `1,010,000` zatoshis.
- `listunspent 10 9999999 [] false` with at least `1,010,000` zatoshis summed from entries whose runtime pool label is exactly `ironwood` and whose `spendable`, `solvable`, and `safe` flags are all true. The pinned source and release binary expose the pool extension, but the published field list omits it, so the application treats it as mandatory evidence rather than assuming it: any missing label fails closed.

The application RPC client preserves decimal ZEC JSON-number tokens as text before decoding can round them. Conversion also accepts an ordinary JavaScript number when its canonical decimal representation resolves exactly to a safe whole-zatoshi integer; sub-zatoshi values and arithmetic noise fail closed. All totals use `bigint` zatoshi arithmetic. Transparent, Sapling, and Orchard entries are exposed only as diagnostic pool totals and cannot satisfy the FullPrivacy gate. If pool labels, safety flags, confirmation counts, exact decimal values, or aggregate consistency cannot be proven, the check fails closed. `z_listtransactions` is not a fallback because it excludes internal change and therefore cannot prove the current unspent pool composition.

## Base Sepolia endpoint

`BASE_SEPOLIA_RPC_URL` selects the read-only endpoint; it must be HTTPS and cannot contain URL credentials or a fragment. The safe default is Base's official `https://sepolia.base.org`, but its public rate limits make a separately configured production-grade provider preferable for repeated production checks. Requests time out after six seconds.

Health checking verifies chain ID `84532`, reads the latest height, fetches that exact block, requires its returned height and 32-byte hash to match, rechecks the chain ID during the same health check, and verifies bytecode at the official Circle Base Sepolia USDC contract. Wrong chain IDs, changing chain identity, mismatched latest-block data, missing contract code, transport failures, and timeouts are never redirected to another network. On 2026-10-24, the default endpoint passed this read-only check at block `49708147`; this observation is not a future availability guarantee.

## Original wallet startup commands

These commands were verified against `zecd run --help` but were **not executed**. They reuse the original private directories and intentionally provide no age identity, mnemonic, UFVK, or unlock material.

```bash
# APPROVAL REQUIRED: start original Wallet A locked on its dedicated loopback RPC.
/home/ali/Desktop/zecathon/experiments/shielded-receiver/zecd-nu7/zecd-0.9.0-rc2-linux-amd64/zecd \
  --testnet \
  --datadir /home/ali/Desktop/zecathon/experiments/shielded-receiver/zecd-nu7/zecd-testnet-data \
  --rpcbind 127.0.0.1 \
  --rpcport 18392 \
  run

# APPROVAL REQUIRED: start original Wallet B locked on its dedicated loopback RPC.
/home/ali/Desktop/zecathon/experiments/shielded-receiver/zecd-nu7/zecd-0.9.0-rc2-linux-amd64/zecd \
  --testnet \
  --datadir /home/ali/.local/share/zecd-wallet-b-testnet \
  --rpcbind 127.0.0.1 \
  --rpcport 18393 \
  run
```

After separate startup approval, run only the read-only checks:

```bash
node --experimental-strip-types -e "import('./server/zcash-source-wallet.ts').then(async m => console.log(JSON.stringify(await m.checkSourceWalletA(), null, 2)))"
node --experimental-strip-types -e "import('./server/operator-preflight.ts').then(async m => console.log(JSON.stringify(await m.checkZcashHealth(), null, 2)))"
BASE_SEPOLIA_RPC_URL='https://YOUR_RELIABLE_BASE_SEPOLIA_ENDPOINT' node --experimental-strip-types -e "import('./server/operator-preflight.ts').then(async m => console.log(JSON.stringify(await m.checkBaseHealth(), null, 2)))"
```

## Remaining operational blockers

Both wallet processes were stopped and ports `18392` and `18393` were not listening during this milestone. Therefore Wallet A's current Ironwood balance, synchronized history, ownership, and locked state, and Wallet B's current sync/history/ownership/lock state remain unmeasured. Wallet A's application reference is also not yet initialized. Starting either wallet, creating an order, deriving an address, and making either payment all require later and separate authorization.
