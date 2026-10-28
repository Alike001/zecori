BEGIN;

ALTER TABLE source_payment_operation_packets
  DROP CONSTRAINT source_payment_operation_packets_state_check,
  ADD COLUMN submission_started_at timestamptz,
  ADD COLUMN recovery_reason text;
UPDATE source_payment_operation_packets
  SET submission_started_at=COALESCE(submission_started_at,updated_at)
  WHERE state<>'PREPARED';
UPDATE source_payment_operation_packets
  SET recovery_reason='legacy-recovery-state'
  WHERE state IN ('SUBMISSION_AMBIGUOUS','RECOVERY_REQUIRED');
ALTER TABLE source_payment_operation_packets
  ADD CONSTRAINT source_payment_operation_packets_state_check CHECK (state IN (
    'PREPARED','SUBMISSION_STARTED','OPID_RECORDED','SUBMISSION_AMBIGUOUS','TXID_RECORDED','RECOVERY_REQUIRED','CANCELLED'
  )),
  ADD CONSTRAINT source_payment_submission_started_check CHECK (
    (state='PREPARED' AND submission_started_at IS NULL)
    OR (state<>'PREPARED' AND submission_started_at IS NOT NULL)
  ),
  ADD CONSTRAINT source_payment_recovery_reason_check CHECK (
    (state IN ('SUBMISSION_AMBIGUOUS','RECOVERY_REQUIRED'))=(recovery_reason IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION guard_source_payment_operation_packet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.packet_digest IS DISTINCT FROM OLD.packet_digest
    OR NEW.encrypted_packet IS DISTINCT FROM OLD.encrypted_packet OR NEW.encryption_key_version IS DISTINCT FROM OLD.encryption_key_version OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.submission_started_at IS NOT NULL AND NEW.submission_started_at IS DISTINCT FROM OLD.submission_started_at) THEN
    RAISE EXCEPTION 'source payment packet binding is immutable';
  END IF;
  IF (OLD.opid_fingerprint IS NOT NULL AND (NEW.opid_fingerprint IS DISTINCT FROM OLD.opid_fingerprint OR NEW.encrypted_opid IS DISTINCT FROM OLD.encrypted_opid))
    OR (OLD.txid_fingerprint IS NOT NULL AND (NEW.txid_fingerprint IS DISTINCT FROM OLD.txid_fingerprint OR NEW.encrypted_txid IS DISTINCT FROM OLD.encrypted_txid)) THEN
    RAISE EXCEPTION 'source payment operation evidence is immutable';
  END IF;
  IF NOT ((OLD.state='PREPARED' AND NEW.state IN ('SUBMISSION_STARTED','CANCELLED'))
    OR (OLD.state='SUBMISSION_STARTED' AND NEW.state IN ('OPID_RECORDED','SUBMISSION_AMBIGUOUS','RECOVERY_REQUIRED'))
    OR (OLD.state='SUBMISSION_AMBIGUOUS' AND NEW.state IN ('OPID_RECORDED','RECOVERY_REQUIRED'))
    OR (OLD.state='OPID_RECORDED' AND NEW.state IN ('TXID_RECORDED','RECOVERY_REQUIRED'))
    OR (OLD.state='RECOVERY_REQUIRED' AND NEW.state='TXID_RECORDED')
    OR NEW.state=OLD.state) THEN RAISE EXCEPTION 'invalid source payment operation transition'; END IF;
  RETURN NEW;
END $$;

INSERT INTO schema_migrations(version) VALUES ('017_wallet_a_submission_recovery') ON CONFLICT DO NOTHING;
COMMIT;
