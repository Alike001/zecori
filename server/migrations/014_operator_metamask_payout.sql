BEGIN;

ALTER TABLE base_payout_signing_packets
  ADD COLUMN submission_method text CHECK (submission_method IN ('RAW_SIGNED','METAMASK'));

ALTER TABLE base_payout_signing_packets
  DROP CONSTRAINT base_payout_signing_packets_check2;
ALTER TABLE base_payout_signing_packets
  ADD CONSTRAINT base_payout_fee_coherence CHECK (max_priority_fee_per_gas>0 AND max_priority_fee_per_gas<=max_fee_per_gas),
  ADD CONSTRAINT base_payout_submission_evidence CHECK (
    (state IN ('PREPARED','CANCELLED') AND signed_transaction_hash IS NULL AND signed_raw_fingerprint IS NULL)
    OR (state='RECOVERY_REQUIRED' AND (
      (submission_method IS NULL AND signed_transaction_hash IS NULL AND signed_raw_fingerprint IS NULL)
      OR (submission_method='RAW_SIGNED' AND signed_transaction_hash IS NOT NULL AND signed_raw_fingerprint IS NOT NULL)
      OR (submission_method='METAMASK' AND signed_raw_fingerprint IS NULL)
    ))
    OR (state='SIGNED' AND submission_method='RAW_SIGNED' AND signed_transaction_hash IS NOT NULL AND signed_raw_fingerprint IS NOT NULL)
    OR (state IN ('SUBMITTED','CONFIRMED') AND signed_transaction_hash IS NOT NULL AND (
      (submission_method='RAW_SIGNED' AND signed_raw_fingerprint IS NOT NULL)
      OR (submission_method='METAMASK' AND signed_raw_fingerprint IS NULL)
    ))
  );

CREATE TABLE base_metamask_payout_submissions (
  packet_id uuid PRIMARY KEY REFERENCES base_payout_signing_packets(packet_id) ON DELETE RESTRICT,
  request_digest bytea NOT NULL UNIQUE CHECK (octet_length(request_digest)=32),
  state text NOT NULL CHECK (state IN ('REHEARSED','SUBMISSION_STARTED','SUBMITTED','RECOVERY_REQUIRED','REJECTED','CONFIRMED')),
  transaction_hash bytea UNIQUE CHECK (transaction_hash IS NULL OR octet_length(transaction_hash)=32),
  rejection_code integer CHECK (rejection_code IS NULL OR rejection_code=4001),
  recovery_reason text,
  rehearsed_at timestamptz NOT NULL,
  submission_started_at timestamptz,
  response_recorded_at timestamptz,
  updated_at timestamptz NOT NULL,
  CHECK (state NOT IN ('SUBMITTED','CONFIRMED') OR transaction_hash IS NOT NULL),
  CHECK (transaction_hash IS NULL OR state IN ('SUBMITTED','RECOVERY_REQUIRED','CONFIRMED')),
  CHECK ((state='REJECTED')=(rejection_code IS NOT NULL)),
  CHECK ((state='RECOVERY_REQUIRED')=(recovery_reason IS NOT NULL))
);

CREATE OR REPLACE FUNCTION guard_metamask_payout_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.packet_id IS DISTINCT FROM OLD.packet_id OR NEW.request_digest IS DISTINCT FROM OLD.request_digest
    OR NEW.rehearsed_at IS DISTINCT FROM OLD.rehearsed_at OR (OLD.submission_started_at IS NOT NULL AND NEW.submission_started_at IS DISTINCT FROM OLD.submission_started_at)
    OR (OLD.transaction_hash IS NOT NULL AND NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash) THEN
    RAISE EXCEPTION 'MetaMask payout submission binding is immutable';
  END IF;
  IF NOT (NEW.state=OLD.state
    OR (OLD.state='REHEARSED' AND NEW.state='SUBMISSION_STARTED')
    OR (OLD.state='SUBMISSION_STARTED' AND NEW.state IN ('SUBMITTED','RECOVERY_REQUIRED','REJECTED'))
    OR (OLD.state='RECOVERY_REQUIRED' AND NEW.state='SUBMITTED')
    OR (OLD.state='SUBMITTED' AND NEW.state IN ('CONFIRMED','RECOVERY_REQUIRED'))) THEN
    RAISE EXCEPTION 'invalid MetaMask payout submission transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER base_metamask_payout_guard BEFORE UPDATE ON base_metamask_payout_submissions
  FOR EACH ROW EXECUTE FUNCTION guard_metamask_payout_submission();

DROP TRIGGER base_payout_packet_guard ON base_payout_signing_packets;
DROP FUNCTION guard_base_payout_signing_packet();
CREATE OR REPLACE FUNCTION guard_base_payout_signing_packet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.packet_id IS DISTINCT FROM OLD.packet_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
    OR NEW.chain_id IS DISTINCT FROM OLD.chain_id OR NEW.sender IS DISTINCT FROM OLD.sender OR NEW.token_contract IS DISTINCT FROM OLD.token_contract
    OR NEW.sender_confirmed_at IS DISTINCT FROM OLD.sender_confirmed_at OR NEW.sender_confirmation_source IS DISTINCT FROM OLD.sender_confirmation_source
    OR NEW.recipient IS DISTINCT FROM OLD.recipient OR NEW.amount_atomic IS DISTINCT FROM OLD.amount_atomic OR NEW.nonce IS DISTINCT FROM OLD.nonce
    OR NEW.gas_limit IS DISTINCT FROM OLD.gas_limit OR NEW.max_fee_per_gas IS DISTINCT FROM OLD.max_fee_per_gas
    OR NEW.max_priority_fee_per_gas IS DISTINCT FROM OLD.max_priority_fee_per_gas OR NEW.calldata IS DISTINCT FROM OLD.calldata
    OR NEW.packet_digest IS DISTINCT FROM OLD.packet_digest OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'base payout signing packet binding is immutable';
  END IF;
  IF (OLD.submission_method IS NOT NULL AND NEW.submission_method IS DISTINCT FROM OLD.submission_method)
    OR (OLD.signed_transaction_hash IS NOT NULL AND NEW.signed_transaction_hash IS DISTINCT FROM OLD.signed_transaction_hash)
    OR (OLD.signed_raw_fingerprint IS NOT NULL AND NEW.signed_raw_fingerprint IS DISTINCT FROM OLD.signed_raw_fingerprint) THEN
    RAISE EXCEPTION 'payout submission evidence is immutable';
  END IF;
  IF NOT ((OLD.state='PREPARED' AND NEW.state IN ('SIGNED','RECOVERY_REQUIRED','CANCELLED'))
    OR (OLD.state='SIGNED' AND NEW.state IN ('SUBMITTED','RECOVERY_REQUIRED'))
    OR (OLD.state='SUBMITTED' AND NEW.state IN ('CONFIRMED','RECOVERY_REQUIRED'))
    OR (OLD.state='RECOVERY_REQUIRED' AND NEW.state IN ('SUBMITTED','CONFIRMED','CANCELLED')) OR NEW.state=OLD.state) THEN
    RAISE EXCEPTION 'invalid base payout packet transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER base_payout_packet_guard BEFORE UPDATE ON base_payout_signing_packets
  FOR EACH ROW EXECUTE FUNCTION guard_base_payout_signing_packet();

INSERT INTO schema_migrations(version) VALUES ('014_operator_metamask_payout') ON CONFLICT DO NOTHING;
COMMIT;
