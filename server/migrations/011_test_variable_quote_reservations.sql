BEGIN;

CREATE TABLE test_variable_rate_approvals (
  approval_id text PRIMARY KEY,
  provider_id text NOT NULL,
  immutable_terms jsonb NOT NULL,
  terms_fingerprint bytea NOT NULL UNIQUE,
  approved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > approved_at),
  liquidity_capacity_destination_atomic numeric(78,0) NOT NULL CHECK (liquidity_capacity_destination_atomic > 0),
  status text NOT NULL CHECK (status IN ('APPROVED','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE test_variable_quote_reservations (
  quote_id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE,
  approval_id text NOT NULL REFERENCES test_variable_rate_approvals(approval_id) ON DELETE RESTRICT,
  binding_fingerprint bytea NOT NULL UNIQUE,
  destination_recipient text NOT NULL CHECK (destination_recipient ~ '^0x[0-9A-Fa-f]{40}$'),
  destination_chain_id integer NOT NULL CHECK (destination_chain_id = 84532),
  destination_token_contract text NOT NULL CHECK (destination_token_contract ~ '^0x[0-9A-Fa-f]{40}$'),
  source_atomic numeric(78,0) NOT NULL CHECK (source_atomic > 0),
  gross_destination_atomic numeric(78,0) NOT NULL CHECK (gross_destination_atomic > 0),
  fee_destination_atomic numeric(78,0) NOT NULL CHECK (fee_destination_atomic >= 0),
  destination_atomic numeric(78,0) NOT NULL CHECK (destination_atomic > 0),
  status text NOT NULL CHECK (status IN ('RESERVED','CONSUMED','RELEASED','RECOVERY_REQUIRED','REFUND_PENDING','REFUNDED')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  consumed_at timestamptz,
  released_at timestamptz,
  recovery_reason text,
  updated_at timestamptz NOT NULL,
  CHECK (gross_destination_atomic = fee_destination_atomic + destination_atomic)
);
CREATE INDEX test_variable_quotes_active_approval
  ON test_variable_quote_reservations(approval_id, status, expires_at);

CREATE OR REPLACE FUNCTION reject_test_rate_approval_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'approved test rate terms are immutable; revoke and create a new approval'; END $$;
CREATE TRIGGER test_rate_approvals_immutable
  BEFORE UPDATE OR DELETE ON test_variable_rate_approvals FOR EACH ROW EXECUTE FUNCTION reject_test_rate_approval_mutation();

CREATE OR REPLACE FUNCTION guard_test_quote_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
     OR NEW.binding_fingerprint IS DISTINCT FROM OLD.binding_fingerprint
     OR NEW.destination_recipient IS DISTINCT FROM OLD.destination_recipient
     OR NEW.destination_chain_id IS DISTINCT FROM OLD.destination_chain_id
     OR NEW.destination_token_contract IS DISTINCT FROM OLD.destination_token_contract
     OR NEW.source_atomic IS DISTINCT FROM OLD.source_atomic
     OR NEW.gross_destination_atomic IS DISTINCT FROM OLD.gross_destination_atomic
     OR NEW.fee_destination_atomic IS DISTINCT FROM OLD.fee_destination_atomic
     OR NEW.destination_atomic IS DISTINCT FROM OLD.destination_atomic
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'test quote binding is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_quote_binding_immutable
  BEFORE UPDATE ON test_variable_quote_reservations FOR EACH ROW EXECUTE FUNCTION guard_test_quote_binding();

INSERT INTO schema_migrations(version) VALUES ('011_test_variable_quote_reservations') ON CONFLICT DO NOTHING;
COMMIT;
