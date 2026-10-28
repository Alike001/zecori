BEGIN;

-- A quote's payment deadline controls whether a new payment is accepted. Once a
-- matching payment is detected, its liquidity remains an obligation while the
-- source output accumulates the required ten confirmations.
DROP TRIGGER test_quote_binding_immutable ON test_variable_quote_reservations;
DROP FUNCTION guard_test_quote_binding();
ALTER TABLE test_variable_quote_reservations
  RENAME COLUMN expires_at TO payment_deadline;
ALTER TABLE test_variable_quote_reservations
  ADD COLUMN confirmation_deadline timestamptz,
  ADD COLUMN source_receiver text,
  ADD COLUMN source_diversifier_index numeric(78,0),
  ADD COLUMN source_not_before_height integer,
  ADD COLUMN source_reference_fingerprint bytea,
  ADD COLUMN source_evidence_fingerprint bytea,
  ADD COLUMN source_block_hash bytea,
  ADD COLUMN source_block_height integer,
  ADD COLUMN source_output_index integer,
  ADD COLUMN source_detected_at timestamptz,
  ADD COLUMN source_confirmed_at timestamptz;
UPDATE test_variable_quote_reservations
  SET confirmation_deadline=payment_deadline + interval '4 hours';
ALTER TABLE test_variable_quote_reservations
  ALTER COLUMN confirmation_deadline SET NOT NULL,
  ADD CONSTRAINT test_quote_confirmation_window CHECK (confirmation_deadline>payment_deadline),
  ADD CONSTRAINT test_quote_source_receiver CHECK (source_receiver IS NULL OR source_receiver ~ '^utest1[a-z0-9]+$'),
  ADD CONSTRAINT test_quote_source_diversifier CHECK (source_diversifier_index IS NULL OR source_diversifier_index>=0),
  ADD CONSTRAINT test_quote_source_height CHECK (source_not_before_height IS NULL OR source_not_before_height>0),
  ADD CONSTRAINT test_quote_source_reference_length CHECK (source_reference_fingerprint IS NULL OR octet_length(source_reference_fingerprint)=32),
  ADD CONSTRAINT test_quote_source_evidence_length CHECK (source_evidence_fingerprint IS NULL OR octet_length(source_evidence_fingerprint)=32),
  ADD CONSTRAINT test_quote_source_block_hash_length CHECK (source_block_hash IS NULL OR octet_length(source_block_hash)=32),
  ADD CONSTRAINT test_quote_source_output CHECK (source_output_index IS NULL OR source_output_index>=0),
  ADD CONSTRAINT test_quote_source_evidence_complete CHECK (
    (source_reference_fingerprint IS NULL AND source_evidence_fingerprint IS NULL AND source_block_hash IS NULL
      AND source_block_height IS NULL AND source_output_index IS NULL AND source_detected_at IS NULL)
    OR
    (source_reference_fingerprint IS NOT NULL AND source_evidence_fingerprint IS NOT NULL AND source_block_hash IS NOT NULL
      AND source_block_height IS NOT NULL AND source_output_index IS NOT NULL AND source_detected_at IS NOT NULL)
  );

ALTER TABLE test_variable_quote_reservations DROP CONSTRAINT test_variable_quote_reservations_status_check;
ALTER TABLE test_variable_quote_reservations ADD CONSTRAINT test_variable_quote_reservations_status_check CHECK (status IN (
  'RESERVED','SOURCE_DETECTED','SOURCE_CONFIRMED','CONSUMED','RELEASED','RECOVERY_REQUIRED','REFUND_PENDING','REFUNDED'
));
DROP INDEX test_variable_quotes_active_approval;
CREATE INDEX test_variable_quotes_active_approval
  ON test_variable_quote_reservations(approval_id,status,payment_deadline,confirmation_deadline);

CREATE TABLE test_variable_rate_approval_events (
  event_id bigserial PRIMARY KEY,
  approval_id text NOT NULL REFERENCES test_variable_rate_approvals(approval_id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('APPROVED','REVOKED')),
  actor_id text NOT NULL,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL
);
INSERT INTO test_variable_rate_approval_events(approval_id,from_status,to_status,actor_id,reason,occurred_at)
  SELECT approval_id,NULL,status,'migration-013','approval state predates immutable event history',created_at
  FROM test_variable_rate_approvals;
CREATE OR REPLACE FUNCTION reject_test_rate_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'test rate approval history is append-only'; END $$;
CREATE TRIGGER test_rate_approval_events_append_only
  BEFORE UPDATE OR DELETE ON test_variable_rate_approval_events FOR EACH ROW EXECUTE FUNCTION reject_test_rate_event_mutation();

DROP TRIGGER test_rate_approvals_immutable ON test_variable_rate_approvals;
DROP FUNCTION reject_test_rate_approval_mutation();
CREATE OR REPLACE FUNCTION guard_test_rate_approval_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'approved test rates cannot be deleted'; END IF;
  IF NEW.approval_id IS DISTINCT FROM OLD.approval_id
    OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
    OR NEW.immutable_terms IS DISTINCT FROM OLD.immutable_terms
    OR NEW.terms_fingerprint IS DISTINCT FROM OLD.terms_fingerprint
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.liquidity_capacity_destination_atomic IS DISTINCT FROM OLD.liquidity_capacity_destination_atomic
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'approved test rate terms and identity are immutable';
  END IF;
  IF NOT (OLD.status='APPROVED' AND NEW.status='REVOKED') THEN
    RAISE EXCEPTION 'only APPROVED to REVOKED is permitted';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_rate_approvals_immutable
  BEFORE UPDATE OR DELETE ON test_variable_rate_approvals FOR EACH ROW EXECUTE FUNCTION guard_test_rate_approval_mutation();

CREATE OR REPLACE FUNCTION guard_test_quote_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quote_id IS DISTINCT FROM OLD.quote_id OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.approval_id IS DISTINCT FROM OLD.approval_id OR NEW.binding_fingerprint IS DISTINCT FROM OLD.binding_fingerprint
    OR NEW.destination_recipient IS DISTINCT FROM OLD.destination_recipient OR NEW.destination_chain_id IS DISTINCT FROM OLD.destination_chain_id
    OR NEW.destination_token_contract IS DISTINCT FROM OLD.destination_token_contract OR NEW.source_atomic IS DISTINCT FROM OLD.source_atomic
    OR NEW.gross_destination_atomic IS DISTINCT FROM OLD.gross_destination_atomic OR NEW.fee_destination_atomic IS DISTINCT FROM OLD.fee_destination_atomic
    OR NEW.destination_atomic IS DISTINCT FROM OLD.destination_atomic OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.payment_deadline IS DISTINCT FROM OLD.payment_deadline OR NEW.confirmation_deadline IS DISTINCT FROM OLD.confirmation_deadline
    OR NEW.source_receiver IS DISTINCT FROM OLD.source_receiver OR NEW.source_diversifier_index IS DISTINCT FROM OLD.source_diversifier_index
    OR NEW.source_not_before_height IS DISTINCT FROM OLD.source_not_before_height
    OR (OLD.source_reference_fingerprint IS NOT NULL AND NEW.source_reference_fingerprint IS DISTINCT FROM OLD.source_reference_fingerprint)
    OR (OLD.source_detected_at IS NOT NULL AND NEW.source_detected_at IS DISTINCT FROM OLD.source_detected_at) THEN
    RAISE EXCEPTION 'test quote binding is immutable';
  END IF;
  IF NOT (NEW.status=OLD.status
    OR (OLD.status='RESERVED' AND NEW.status IN ('SOURCE_DETECTED','RELEASED','REFUND_PENDING','RECOVERY_REQUIRED'))
    OR (OLD.status='RELEASED' AND NEW.status IN ('REFUND_PENDING','RECOVERY_REQUIRED'))
    OR (OLD.status='SOURCE_DETECTED' AND NEW.status IN ('SOURCE_CONFIRMED','RECOVERY_REQUIRED','REFUND_PENDING'))
    OR (OLD.status='SOURCE_CONFIRMED' AND NEW.status IN ('CONSUMED','RECOVERY_REQUIRED'))
    OR (OLD.status='CONSUMED' AND NEW.status='RECOVERY_REQUIRED')
    OR (OLD.status='RECOVERY_REQUIRED' AND NEW.status IN ('SOURCE_DETECTED','SOURCE_CONFIRMED','REFUND_PENDING','REFUNDED'))
    OR (OLD.status='REFUND_PENDING' AND NEW.status IN ('RECOVERY_REQUIRED','REFUNDED'))) THEN
    RAISE EXCEPTION 'invalid test quote settlement transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_quote_binding_immutable
  BEFORE UPDATE ON test_variable_quote_reservations FOR EACH ROW EXECUTE FUNCTION guard_test_quote_binding();

CREATE OR REPLACE FUNCTION quarantine_variable_quote_payout_on_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='RECOVERY_REQUIRED' AND OLD.status<>'RECOVERY_REQUIRED' THEN
    UPDATE base_payout_signing_packets
      SET state='RECOVERY_REQUIRED',updated_at=NEW.updated_at
      WHERE order_id=NEW.order_id AND state IN ('PREPARED','SIGNED','SUBMITTED');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER variable_quote_recovery_quarantines_payout
  AFTER UPDATE OF status ON test_variable_quote_reservations FOR EACH ROW
  EXECUTE FUNCTION quarantine_variable_quote_payout_on_recovery();

INSERT INTO schema_migrations(version) VALUES ('013_real_settlement_safety_gates') ON CONFLICT DO NOTHING;
COMMIT;
