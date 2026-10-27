# Spec: Transactional outbox and private inbox

Status: `EXPERIMENTAL` — migration `010_handles_contacts_inbox.sql` implements the durable outbox, owner-scoped in-app inbox, and delivery-attempt ledger. Email and every other external channel remain disabled.

Implementation note: the in-process dispatcher runs bounded leased batches and persists replay/idempotency state in PostgreSQL. No email sender or notification preference endpoint was added.

## Objective

Create durable notifications only from committed, verified backend order events, deliver them to the owning internal UUID account, and never turn anticipated settlement into a success alert.

## Goals

- Atomic event/outbox persistence with the order state transition.
- Owner-isolated in-app inbox with read/unread state.
- Idempotent materialization, bounded retries, and dead-letter review.
- Event-specific redaction before data enters an outbox payload.
- Opt-in email only after the in-app model is accepted.

## Non-goals

- Browser-generated success notifications, marketing messages, wallet monitoring, or public activity feeds.
- Including a destination address, shielded receiver, transaction identifier, viewing key, signature, email address, or private evidence in an outbox payload.
- Allowing delivery failure to roll back or advance settlement.

## Proposed data model

### `transactional_outbox`

`outbox_id` UUID primary key; `aggregate_type`; `aggregate_id`; `aggregate_version`; `event_type`; `recipient_user_id`; `privacy_class`; redacted `payload`; `occurred_at`; `available_at`; `status` (`PENDING`, `PROCESSING`, `DELIVERED`, `RETRY`, `DEAD`); `attempt_count`; `lease_owner`; `lease_expires_at`; `last_error_code`; `delivered_at`.

Unique `(aggregate_type, aggregate_id, aggregate_version, event_type, recipient_user_id)` provides producer idempotency. Insert occurs in the same PostgreSQL transaction as the authoritative state change and audit event.

### `inbox_items`

`inbox_item_id`; unique `outbox_id`; `user_id`; `category`; `title_key`; redacted `body_variables`; optional owner-scoped `request_id`; `created_at`; `read_at`; `archived_at`. Index `(user_id, read_at, created_at DESC)`. Reads and mutations always include `user_id` in the predicate.

### `notification_preferences` — later

`user_id`; `channel`; `event_family`; `enabled`; `verified_destination_id`; `updated_at`; `version`. Email is default-off and references a separately encrypted, verified delivery destination. No raw email appears in an outbox record.

### `notification_delivery_attempts`

Append-only operational record: `attempt_id`, `outbox_id`, `channel`, `attempt_number`, `started_at`, `finished_at`, `outcome_code`, `provider_request_fingerprint`, and next retry time. Store no rendered private body or provider response body.

## Event contract

Only an allow-list of committed backend events can notify:

| Event | Inbox wording boundary |
|---|---|
| `REQUEST_RECEIVED` | Request entered operator review; no payment instruction exists. |
| `PAYMENT_INSTRUCTIONS_PUBLISHED` | Instructions are available inside the authenticated request; never include the receiver in the notification. |
| `SOURCE_DETECTED` | A candidate source payment was observed; not confirmed. |
| `SOURCE_CONFIRMED` | Required source confirmations were independently recorded. |
| `PAYOUT_AWAITING_APPROVAL` | Payout is awaiting separate approval; not sent. |
| `PAYOUT_SUBMITTED` | A candidate payout was submitted; not complete. |
| `FINAL_RECEIPT_CREATED` | Settlement is complete only because the independently verified final receipt exists. |
| `FAILED`, `UNRESOLVED`, `EXPIRED`, `CANCELLED`, `REFUND_PENDING`, `REFUNDED` | Use the exact backend state and approved recovery copy. Refund pending never says refunded. |

No notification may derive from client navigation, model output, optimistic UI, transaction submission alone, or an operator intention.

## Dispatcher semantics

- Claim rows with `FOR UPDATE SKIP LOCKED`, a short lease, and deterministic batch limits.
- Materialize inbox items with `INSERT ... ON CONFLICT DO NOTHING`; delivery is at-least-once but visible inbox state is idempotent.
- Retry transient failures with capped exponential backoff plus jitter. Permanent schema/privacy violations go directly to `DEAD` and raise an operational alert without user data.
- A crashed worker releases through lease expiry. Attempt count and maximum age bound retries.
- Inbox delivery never changes the order state. An unavailable inbox does not block settlement verification.

## Planned API

- `GET /api/v1/inbox?cursor=...` — authenticated owner-only, newest first, bounded page.
- `GET /api/v1/inbox/unread-count` — authenticated owner-only aggregate.
- `POST /api/v1/inbox/:id/read` and `/unread` — CSRF-protected idempotent updates scoped by `user_id`.
- `POST /api/v1/inbox/read-all` — CSRF-protected, bounded to the current user.
- Preferences and email endpoints stay absent until in-app acceptance and verified opt-in design are approved.

## Privacy and isolation requirements

- Redaction occurs synchronously before outbox insertion using an event-specific schema; arbitrary order objects are rejected.
- Payloads contain request UUID only when the inbox consumer is owner-authenticated. They never contain recipient addresses, payment receivers, signatures, transaction hashes, or provider evidence.
- Cross-account item IDs return the same 404 as missing items.
- Logs contain outbox IDs, event types, attempt counts, and error codes only.
- AI tools may read an already-redacted owner-authorized status; they cannot read the inbox or trigger delivery.

## Acceptance Criteria

- Rolling back an order transition also rolls back its outbox event.
- Reprocessing the same outbox event creates one inbox item.
- Account B cannot list, count, read, or infer Account A’s notifications.
- Every success notification is traceable to `FINAL_RECEIPT_CREATED`; submitted/detected states never use success copy.
- Retry, lease recovery, dead-letter, read/unread, pagination, and redaction have PostgreSQL integration tests.
- Email remains absent and disabled until explicit opt-in, verification, retention, and provider review are complete.

## Source References

`server/migrations/001_production_foundation.sql`, `002_settlement_integration.sql`, `server/postgres-settlement-store.ts`, `server/public-order-store.ts`, and `server/agent-tools.ts`.
