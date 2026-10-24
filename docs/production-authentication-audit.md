# Production authentication audit

Reviewed 2026-10-24.

## Verified controls

- Order reads are scoped by both order/request ID and `SHA-256(owner session secret)` in PostgreSQL. A second independently generated session receives `404`, including for private receipts.
- State transitions, wallet RPC, allocation, payout approval and broadcast are absent from the public API. Operator mutations exist only in the interactive PostgreSQL CLI.
- Non-GET API calls require an exact configured Origin, JSON content type and timing-safe double-submit CSRF value. Cookies are `SameSite=Strict`; production cookies add `Secure`; the owner cookie is `HttpOnly`.
- Private receipts require the owner session and AES-256-GCM decryption. Shareable receipts remove both chain transaction IDs, the receiver, internal order ID, source amount/time/chain/asset and fee data.
- Settlement state is PostgreSQL-authoritative and survives browser-session expiry and server restarts. Expiry cannot erase or roll back an order.

## Durable account recovery implemented in milestone 05

The former random 24-hour owner capability has been replaced by a stable PostgreSQL user identity authenticated with WebAuthn passkeys. Sessions are opaque, hashed, database-backed, rotated after registration/additional-passkey ceremonies, revocable on logout, and bounded to seven days. Order ownership hashes the stable user UUID, so history and private receipts survive new authenticated sessions.

Each account supports multiple credentials and the UI instructs users to register at least two. There is no email, magic-link, static-token, receipt-ID, transaction-ID or support-question recovery route. Losing every registered passkey is intentionally unrecoverable rather than falling back to weak proof.

Production still requires HTTPS and an explicitly configured RP ID. Localhost credentials are scoped to `localhost` and cannot be assumed to work on a deployment domain. See [staging milestone 05](staging-milestone-05.md) for validation and remaining operational blockers.
