# Production authentication audit

Reviewed 2026-10-24.

## Verified controls

- Order reads are scoped by both order/request ID and `SHA-256(owner session secret)` in PostgreSQL. A second independently generated session receives `404`, including for private receipts.
- State transitions, wallet RPC, allocation, payout approval and broadcast are absent from the public API. Operator mutations exist only in the interactive PostgreSQL CLI.
- Non-GET API calls require an exact configured Origin, JSON content type and timing-safe double-submit CSRF value. Cookies are `SameSite=Strict`; production cookies add `Secure`; the owner cookie is `HttpOnly`.
- Private receipts require the owner session and AES-256-GCM decryption. Shareable receipts remove both chain transaction IDs, the receiver, internal order ID, source amount/time/chain/asset and fee data.
- Settlement state is PostgreSQL-authoritative and survives browser-session expiry and server restarts. Expiry cannot erase or roll back an order.

## Production blocker: durable account recovery

The current owner identity is a random 256-bit browser capability cookie with a 24-hour lifetime. It is high entropy and prevents guessing/cross-user lookup, but it is still a bearer secret: browser loss or expiry removes the user's ability to retrieve an otherwise durable order, and theft grants the thief that access. There is deliberately no recovery endpoint.

Public launch must not enable weak token-only recovery. Before public exposure, choose and implement one reviewed recovery model, preferably WebAuthn/passkeys with a separately authenticated recovery credential or an external identity provider with phishing-resistant MFA. Bind orders to the durable account identifier, rotate sessions server-side, revoke sessions, preserve CSRF/origin checks, and migrate existing anonymous requests only after fresh strong authentication. Email magic links, receipt IDs, transaction IDs, destination addresses, support questions and static recovery codes alone are not sufficient proof.

Until that work is complete, the correct launch status is blocked even though cross-session database queries and private-receipt ownership checks pass.
