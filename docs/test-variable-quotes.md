# Disabled test-only variable quotes

Status: implemented for isolated tests only. The public product, API, fixed route, Render configuration, and settlement workflow do not use this module.

The engine in `server/test-variable-quote.ts` is a future acceptance seam for variable test amounts. It uses decimal strings parsed to `bigint`; floating-point amounts are rejected. A quote requires an explicit provider approval record containing a rational atomic rate, approval window, fees, min/max, and destination-liquidity capacity.

Rounding is deterministic: gross destination atomic units round down, the basis-point fee rounds up, and the fixed destination-atomic fee is added afterward. A quote reserves the exact post-fee destination amount. The reservation is bound to one UUID order, normalized full recipient, source atomic amount, and provider approval. The same request is idempotent; conflicting terms fail. Expired reservations release capacity; consumed reservations remain allocated and cannot be replaced.

The module labels every result as an `operator-approved-test-rate-not-market-price`. It does not fetch a price, assert market value, allocate a wallet address, create an order, publish instructions, sign, broadcast, or pay out.

Acceptance before any wiring requires persistent transactional storage with row locking, provider-signature verification, restart and multi-process concurrency tests, authenticated API and owner binding, UI disclosures, operator liquidity reconciliation, and a separate decision to change route flags. None of those steps is authorized by this document.
