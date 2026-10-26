# Spec: Optional @handles and private contacts

Status: `PLANNED` — reviewed design only. No handle resolution or payment-by-handle endpoint exists.

## Objective

Let an authenticated user claim one optional memorable handle and save private contacts without creating a public address directory, weakening account recovery, or allowing a handle to bypass destination ownership proof.

## Background And Current Reality

Internal UUIDs own sessions, requests, destinations, and history. Privy and passkeys are authentication methods mapped to those UUIDs; they are not settlement identities. Base destinations are encrypted and require owner-scoped EIP-712 or ERC-1271 proof. Zcash shielded receivers and settlement evidence are private. These invariants remain authoritative.

## Goals

- Unique, normalized, optional handles with explicit owner authorization.
- Exact-match discovery that resists bulk enumeration.
- Owner-private contacts and aliases.
- Versioned destination changes with proof and revocation.
- Recovery through the existing authenticated UUID account, never email matching.
- Future destination resolution that returns no Zcash receiver, viewing key, correlation, or private contact relationship.

## Non-goals

- Payments by handle in this milestone.
- Public profiles, prefix search, contact graphs, address books, follower counts, or presence.
- Publishing Zcash receivers, viewing keys, transaction IDs, payment correlations, or account-provider identifiers.
- Treating possession of an email, display name, handle, or wallet address as account ownership.

## Proposed data model

All identifiers are UUIDs; timestamps are UTC. Sensitive values use the existing versioned application encryption envelope.

### `account_handles`

| Column | Constraint | Purpose |
|---|---|---|
| `handle_id` | primary key | Stable record identifier. |
| `user_id` | unique FK `users` | At most one active handle per internal account. |
| `normalized_handle` | unique `citext` or unique index on normalized text | Lookup key; NFKC + lowercase ASCII policy. |
| `display_handle` | text | Original approved casing, never identity authority. |
| `status` | `ACTIVE`, `LOCKED`, `RETIRED` | Fail-closed lifecycle. |
| `claimed_at`, `updated_at` | timestamps | Audit support. |
| `retired_at`, `reuse_after` | nullable timestamps | Prevent immediate impersonation after rename. |
| `version` | positive bigint | Optimistic concurrency and authorization binding. |

Allowed syntax: 3–24 ASCII lowercase characters after normalization; starts with a letter; contains only letters, digits, and single hyphens; no leading/trailing or repeated hyphen. Confusable Unicode is rejected rather than transliterated.

### `reserved_handles`

`normalized_handle` primary key, `reason_code`, `created_at`, and optional `expires_at`. Seed from system routes, brands, roles, security terms, chain/token names, and common impersonation targets. The application returns the same generic unavailable response for reserved and already-owned values.

### `handle_history`

Append-only `history_id`, `handle_id`, `user_id`, `normalized_handle`, `event_type`, `version`, `occurred_at`, and non-sensitive `reason_code`. Never store email, wallet address, or identity-provider subject in details.

### `destination_bindings`

Versioned future abstraction over the existing encrypted destination intent: `binding_id`, `user_id`, `network`, `asset_scope`, encrypted destination envelope, keyed destination fingerprint, proof type, proof reference, proof time, `ACTIVE/REVOKED/EXPIRED`, `valid_from`, `valid_until`, and `version`. A new address inserts a new version; it never mutates a binding used by an existing request.

No Zcash shielded receiver or viewing key is a resolvable destination binding. Provider-allocated source receivers remain order-specific and inaccessible to directory APIs.

### `private_contacts`

| Column | Constraint | Purpose |
|---|---|---|
| `contact_id` | primary key | Owner-private contact. |
| `owner_user_id` | FK and indexed | Authorization scope. |
| `target_handle_id` | nullable FK | Stable target when accepted. |
| `lookup_fingerprint` | keyed hash | Exact-match retry without storing query text. |
| `encrypted_label` | encrypted | Owner-chosen name. |
| `status` | `PENDING`, `ACTIVE`, `STALE`, `REMOVED` | No implicit relationship claim. |
| `created_at`, `updated_at` | timestamps | Audit support. |

Unique `(owner_user_id, target_handle_id)` for non-removed contacts. Neither side can list the other side’s contact graph. A target does not learn who looked them up.

## Planned API contract

Every mutation requires an authenticated internal UUID session, exact origin, JSON content type, and CSRF. Responses use generic errors and strict schemas.

- `POST /api/v1/handles/availability` — exact normalized candidate only; authenticated; heavily rate-limited; returns `{available: boolean}` with no owner metadata and indistinguishable reserved/claimed responses.
- `PUT /api/v1/account/handle` — claim or rename with `{candidate, expectedVersion, confirmation}`. Requires recent strong authentication and records an audit event.
- `DELETE /api/v1/account/handle` — retires with explicit confirmation and reuse delay; never deletes history.
- `GET /api/v1/account/handle` — owner-only current state.
- `POST /api/v1/contacts` — saves an exact handle reference with an encrypted private label; does not expose destination data.
- `GET /api/v1/contacts` — owner-only, cursor-based list; no global search.
- `PATCH /api/v1/contacts/:id` and `DELETE /api/v1/contacts/:id` — owner-only label/status changes.
- `POST /api/v1/destination-bindings` — future versioned, proof-required destination registration; unsupported networks fail closed.
- `POST /api/v1/handles/:handle/resolution-intents` — **must remain absent** until a payment rail can atomically enforce an active verified binding. Future success returns an opaque, short-lived, audience-bound resolution token to the requesting order flow, never a raw address.

## Anti-enumeration and privacy requirements

- No anonymous availability or lookup, wildcard, prefix, fuzzy, bulk, or sequential APIs.
- Per-account, per-IP, and global rate limits with bounded request size and uniform response shape/timing budget.
- Generic `HANDLE_UNAVAILABLE` and `CONTACT_NOT_FOUND` responses; no owner UUID, email, provider, activity, or registration timestamp.
- Audit abusive lookup patterns using keyed fingerprints, not plaintext candidates.
- Contact existence, labels, and edges never enter logs, analytics, model prompts, or public receipts.
- An assistant may explain the feature status but cannot call lookup or resolution tools.

## Recovery and address changes

- Handle recovery follows recovery of the existing UUID account through registered passkeys or an already-linked verified identity. Email similarity never links or merges accounts.
- High-risk rename, retirement, and destination-change actions require recent authentication and an explicit confirmation phrase; session age policy must be defined before implementation.
- A destination change requires a fresh ownership proof and inserts a new immutable version. Existing orders remain bound to their original encrypted recipient and proof.
- Compromised or disputed accounts lock the handle and all future resolution; they do not transfer it automatically.

## Acceptance Criteria

- Concurrent claims cannot produce duplicate normalized handles.
- Claimed, reserved, missing, locked, and retired candidates are indistinguishable to unauthorized callers.
- Cross-account reads and contact mutations return no relationship or destination data.
- Renaming cannot change an existing order’s recipient.
- No endpoint returns a shielded receiver, viewing key, raw private contact mapping, or payment correlation.
- Payment-by-handle remains impossible until an independently reviewed rail enforces verified recipient binding atomically.

## Open Questions

- Final handle reuse delay and legal impersonation process.
- Whether accepted mutual contacts are needed at all; owner-private bookmarks are safer.
- Which future destination networks can provide a proof equivalent to the Base destination-control ceremony.

## Source References

`server/migrations/005_passkey_identity.sql`, `007_owner_destination_binding.sql`, `008_destination_wallet_control.sql`, `009_privy_identity.sql`, `server/privy-auth.ts`, and `server/public-api.ts`.
