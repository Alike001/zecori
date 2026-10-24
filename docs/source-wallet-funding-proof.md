# Wallet A Ironwood funding proof

Audited against zecd `v0.9.0-rc2`, commit `56e809fb4a3abf122505a28163321149a8823413`.

## RPC wire contract

- `getbalance "*" 10` is the confirmed spendable **aggregate across every pool**. Its wire value is a JSON number in decimal ZEC, not a pool balance. It is accepted either as the original decimal token preserved by this application's RPC parser or as an ordinary JavaScript number that resolves unambiguously to a safe whole-zatoshi integer.
- The release's published `listunspent` prose documents the Bitcoin Core-shaped fields but does not establish a pool discriminator. The pinned source's `unspent_json` implementation adds `pool`, and the exact release binary was observed returning it. The application does not assume it is present: every entry must carry one recognized pool label or readiness fails closed.
- `z_listtransactions` carries `pool` and exact `amountZat`, but deliberately omits internal change. It is transaction history, not a current unspent-note set, and cannot repair a pool-blind `listunspent` response.

Relevant upstream sources: [balance RPC reference](https://zecd.org/rpc/wallet-balances.html), [history and unspent RPC reference](https://zecd.org/rpc/wallet-history.html), and the [pinned wallet RPC implementation](https://github.com/zecrocks/zecd/blob/56e809fb4a3abf122505a28163321149a8823413/src/rpc/wallet_methods.rs).

## Readiness rule

After proving testnet sync, complete enhanced history, wallet identity/ownership, and locked state, the application:

1. validates every `listunspent 10 9999999 [] false` entry's confirmation count and `spendable`, `solvable`, and `safe` flags;
2. parses every amount to integer zatoshis;
3. totals entries by their mandatory runtime `pool` label;
4. checks the Ironwood subtotal does not exceed the aggregate `getbalance`; and
5. declares FullPrivacy funding ready only when both the aggregate and Ironwood subtotal are at least `1,010,000` zatoshis (`1,000,000` payment plus `10,000` fee reserve).

If `pool` is missing, the specific failure is: `Wallet A Ironwood spendability cannot be proven ... aggregate getbalance and z_listtransactions history cannot identify current unspent Ironwood notes because internal change is excluded`.

No history-derived estimate or aggregate balance is substituted for current Ironwood spendability.
