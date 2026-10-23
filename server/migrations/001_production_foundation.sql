BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_order_requests (
  request_id uuid PRIMARY KEY,
  owner_session_hash bytea NOT NULL,
  status text NOT NULL CHECK (status IN ('AWAITING_OPERATOR', 'PAYMENT_READY', 'LINKED', 'EXPIRED', 'CANCELLED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  destination_recipient text NOT NULL CHECK (destination_recipient ~ '^0x[0-9A-Fa-f]{40}$'),
  immutable_terms jsonb NOT NULL,
  linked_order_id uuid UNIQUE,
  encrypted_payment_receiver bytea,
  payment_receiver_key_version integer CHECK (payment_receiver_key_version IS NULL OR payment_receiver_key_version > 0),
  CHECK ((status IN ('PAYMENT_READY','LINKED')) = (encrypted_payment_receiver IS NOT NULL)),
  CHECK ((encrypted_payment_receiver IS NULL) = (payment_receiver_key_version IS NULL)),
  CHECK (linked_order_id IS NULL OR status = 'LINKED')
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_request_per_session
  ON public_order_requests (owner_session_hash) WHERE status = 'AWAITING_OPERATOR';
CREATE INDEX IF NOT EXISTS public_order_requests_owner_created
  ON public_order_requests (owner_session_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  order_id uuid PRIMARY KEY,
  owner_session_hash bytea NOT NULL,
  immutable_manifest jsonb NOT NULL,
  public_view jsonb NOT NULL,
  encrypted_private_state bytea NOT NULL,
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  status text NOT NULL CHECK (status IN ('CREATED','AWAITING_PAYMENT','SOURCE_DETECTED','SOURCE_CONFIRMED','PAYOUT_AWAITING_APPROVAL','PAYOUT_SUBMITTED','COMPLETED','FAILED','REFUND_PENDING','REFUNDED','UNRESOLVED')),
  state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS orders_owner_created ON orders (owner_session_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS address_allocation_journal (
  allocation_id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE RESTRICT,
  address_fingerprint bytea NOT NULL UNIQUE,
  diversifier_fingerprint bytea NOT NULL UNIQUE,
  encrypted_receiver bytea NOT NULL,
  journal_phase text NOT NULL CHECK (journal_phase IN ('AUTHORIZED','DERIVATION_STARTED','DERIVED','RESERVED','ACTIVATED','RECOVERY_REQUIRED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS authorization_records (
  authorization_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('ADDRESS_ALLOCATION','PAYOUT')),
  operator_id text NOT NULL,
  manifest_fingerprint bytea NOT NULL,
  state text NOT NULL CHECK (state IN ('ISSUED','CONSUMED','EXPIRED','REVOKED')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (order_id, kind, authorization_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_consumed_authorization_per_kind
  ON authorization_records (order_id, kind) WHERE state = 'CONSUMED';

CREATE TABLE IF NOT EXISTS settlement_evidence (
  evidence_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
  chain text NOT NULL CHECK (chain IN ('zcash-testnet','base-sepolia')),
  reference_fingerprint bytea NOT NULL,
  encrypted_evidence bytea NOT NULL,
  independently_verified_at timestamptz NOT NULL,
  UNIQUE (chain, reference_fingerprint)
);

CREATE TABLE IF NOT EXISTS receipts (
  receipt_id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE RESTRICT,
  public_receipt jsonb NOT NULL,
  encrypted_private_receipt bytea NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id bigserial PRIMARY KEY,
  order_id uuid REFERENCES orders(order_id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('SYSTEM','USER','OPERATOR','VERIFIER')),
  actor_fingerprint bytea,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_immutable_order_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.immutable_manifest IS DISTINCT FROM OLD.immutable_manifest OR NEW.owner_session_hash IS DISTINCT FROM OLD.owner_session_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'immutable order fields cannot be changed';
  END IF;
  IF NEW.state_version <> OLD.state_version + 1 THEN RAISE EXCEPTION 'order state version must advance exactly once'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS orders_immutable_guard ON orders;
CREATE TRIGGER orders_immutable_guard BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION reject_immutable_order_changes();

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit events are append-only'; END $$;
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

INSERT INTO schema_migrations(version) VALUES ('001_production_foundation') ON CONFLICT DO NOTHING;
COMMIT;
