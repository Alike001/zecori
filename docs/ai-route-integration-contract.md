# AI route integration contract

Status: deterministic assistant `VERIFIED`; Groq-backed mode `TEST-ONLY/PENDING LIVE VALIDATION`; voice `DISABLED`.

## Purpose

Chat and any future voice adapter use one server policy engine, one allow-listed tool registry, and typed application-rendered cards. Natural-language text is advisory. It is never a transaction intent, approval, signature, or source of financial truth.

## Typed cards

1. `route-explanation` — canonical route ID, source/destination networks and assets, shielded-source disclosure, custody limit, and no-authority flags.
2. `route-availability` — every canonical route and its exact availability classification; only registry-enabled routes may expose an open-route action.
3. `quote-comparison` — `available: false` unless a future independently verified quote feed returns timestamped, provider-scoped quotes. Fixed test terms remain separately labeled.
4. `review-preparation` — exact fixed terms and a checklist; `createsOrder`, `authorizesPayment`, and `signsTransaction` are always false.
5. `order-status` — owner-authorized request ID, backend status, bounded timeline, receipt availability, and no destination/payment data.
6. `failure-recovery` — owner-authorized failure status, sanitized reason code, and status-specific safe next action. Never promises a refund.

Cards are constructed by application code from validated tool output, not parsed from model prose. Unknown card kinds or fields fail schema validation.

## Tool and authorization rules

- Public: route explanation, route availability, quote-unavailable comparison, privacy explanation, and non-authorizing review preparation.
- Authenticated: list owner requests, read owner request status, explain owner request recovery, and retrieve an owner-authorized redacted receipt.
- Forbidden: handle/contact lookup, inbox access, raw destination reads, payment receiver reads, private receipt/evidence reads, wallet RPC, order creation, address derivation, signing, broadcasting, allocation, approval, payout, refund mutation, or operator commands.
- Account-scoped tools re-resolve ownership in the data store; the model cannot supply a user ID.

## Input and output policy

- Reject wallet addresses, shielded receivers, transaction identifiers, viewing/spending keys, cookies, authorization headers, signatures, and operator secrets before any external model call.
- Bound message length, provider calls, output tokens, tool output bytes, timeout, and request rate.
- Send only redacted structured tool output with an explicit untrusted-data marker.
- Reject fabricated networks, routes, providers, amounts, chain IDs, hashes, completion claims, live-quote claims, or execution claims.
- Return a deterministic refusal without echoing rejected private input.
- Public diagnostics may contain only sanitized model text and are unavailable in authenticated contexts.

## Quote policy

No verified quote feed exists. `compare_verified_quotes` must return `available: false` and the fixed test terms with a “not a market quote” disclosure. A future quote adapter needs provider authentication, expiry, asset/chain identity, atomic units, fee decomposition, replay protection, and independent schema validation before its data may enter a card.

## Chat and future voice

Voice may transcribe into the same bounded message endpoint only after a separate consent and retention review. It receives no extra tools. Spoken output is generated from the same validated reply/cards and must announce that it cannot authorize payment. A voice transcript is never sufficient consent for an order, signature, payout, contact resolution, or account link.

## Acceptance Criteria

- Each supported tool emits the expected typed card without private fields.
- Disabled routes and quote feeds cannot produce actionable cards.
- Cross-account request/status/receipt probes return no existence signal beyond owner-scoped not-found behavior.
- Prompt injection and private-shaped inputs stop before provider access.
- Fabricated live claims are rejected even when returned by the configured model.
- No registered tool or card includes financial mutation authority.

## Source References

`server/agent-gateway.ts`, `server/agent-tools.ts`, `server/agent-response-validation.ts`, `src/lib/route-capabilities.ts`, and `docs/ai-agent-operations.md`.
