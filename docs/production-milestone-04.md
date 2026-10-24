# Production milestone 04 — readiness record

Status: **implementation complete; operational readiness blocked**. No wallet start, address derivation, source payment, payout, or deployment was performed.

## Implemented allocation guarantees

- Migration `004_crash_safe_address_allocation` makes PostgreSQL authoritative for allocation authorization, the encrypted exact diversifier journal, RPC attempt state, encrypted receiver, reservation, cancellation, and audit history.
- One accepted request/order is locked and revalidated for owner binding, signed immutable manifest, fixed amount, full Base recipient, expiry, Zcash testnet Ironwood source, Base Sepolia destination, official Circle test USDC contract, trusted provider, and operator identity.
- The exact diversifier is checked against complete wallet payment history and PostgreSQL uniqueness, encrypted and committed before `z_getaddressforaccount` is callable.
- The returned Unified Address must be testnet, owned, consistent, Orchard-only, locked-wallet derived, at the exact index, and absent from prior address/diversifier payment history.
- Publication is a later transaction and requires a durable `RESERVED` allocation. A receiver is never printed by the operator CLI or stored in audit details.
- Duplicate requests and competing workers converge on the same order-scoped journal. A timeout/disconnect remains `RPC_UNCERTAIN`; a crash remains at its last durable phase. Reconciliation uses only the same index, including after authorization expiry.
- Cancellation is allowed only in `JOURNALED` with zero RPC attempts. Once an attempt begins, the operation cannot be discarded or replaced automatically.

## Environment observations on 2026-10-24

- The private Base operator configuration is valid for Base Sepolia chain `84532` and contains complete, distinct LP and recipient addresses. The recipient should be re-confirmed interactively before accepting the real test request; do not copy it into logs or documentation.
- Wallet A's application reference is not initialized and no `zecd`/`zcashd` process is running. Confirmed spendable TAZ and the `10,000`-zatoshi fee reserve therefore could not be measured. This is a blocker. Reuse the existing Wallet A data directory; do not create or import another wallet.
- Wallet B's configured data path has no RPC cookie and no wallet process is running. Network sync, locked state, history completeness, and ownership therefore could not be verified. This is a blocker. No UFVK or spending credential is required or permitted.
- No accepted first-test PostgreSQL order was created because doing so requires a fresh user request and explicit operator acceptance.

## Recovery limitations

- PostgreSQL cannot prove whether an RPC reached Wallet B after a transport timeout. The safe response is explicit reconciliation at the same deterministic diversifier, not replacement.
- An operator may need to repeat reconciliation after PostgreSQL or Wallet B becomes available. Pending records remain durable and visible; they are not silently expired.
- Cancellation after an RPC attempt is intentionally forbidden. A permanently inconsistent wallet response requires manual investigation and remains `RECOVERY_REQUIRED`/`RPC_UNCERTAIN`.
- Pre-RPC cancellation is terminal for that order's journal. If testing is still desired, accept a new order rather than reusing the cancelled order or diversifier.
- Source signing and Base payout signing remain external, separately approved procedures. This application records and independently verifies transaction identifiers but cannot execute either payment.

The complete future approval sequence is in [first-linked-test-readiness.md](first-linked-test-readiness.md).
