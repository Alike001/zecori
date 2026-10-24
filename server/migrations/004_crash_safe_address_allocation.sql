BEGIN;

ALTER TABLE authorization_records DROP CONSTRAINT IF EXISTS authorization_records_state_check;
ALTER TABLE authorization_records
  ADD CONSTRAINT authorization_records_state_check CHECK (state IN (
    'ISSUED','IN_PROGRESS','CONSUMED','EXPIRED','REVOKED','CANCELLED'
  ));

DROP INDEX IF EXISTS one_live_address_authorization;
CREATE UNIQUE INDEX one_live_address_authorization
  ON authorization_records(order_id, kind)
  WHERE kind = 'ADDRESS_ALLOCATION' AND state IN ('ISSUED','IN_PROGRESS');

ALTER TABLE address_allocation_journal DROP CONSTRAINT IF EXISTS address_allocation_journal_journal_phase_check;
ALTER TABLE address_allocation_journal ALTER COLUMN address_fingerprint DROP NOT NULL;
ALTER TABLE address_allocation_journal ALTER COLUMN encrypted_receiver DROP NOT NULL;
ALTER TABLE address_allocation_journal
  ADD COLUMN IF NOT EXISTS encrypted_derivation bytea,
  ADD COLUMN IF NOT EXISTS rpc_attempt_count integer NOT NULL DEFAULT 0 CHECK (rpc_attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS rpc_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS derived_at timestamptz,
  ADD COLUMN IF NOT EXISTS reserved_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD CONSTRAINT address_allocation_journal_phase_check CHECK (journal_phase IN (
    'AUTHORIZED','JOURNALED','DERIVATION_STARTED','RPC_UNCERTAIN','DERIVED','RESERVED',
    'ACTIVATED','RECOVERY_REQUIRED','CANCELLED'
  )),
  ADD CONSTRAINT address_allocation_derivation_journal_check CHECK (
    journal_phase IN ('AUTHORIZED','RESERVED','ACTIVATED') OR encrypted_derivation IS NOT NULL
  ),
  ADD CONSTRAINT address_allocation_rpc_attempt_check CHECK (
    rpc_attempt_count = 0 OR rpc_attempted_at IS NOT NULL
  ),
  ADD CONSTRAINT address_allocation_cancellation_check CHECK (
    (journal_phase = 'CANCELLED') = (cancelled_at IS NOT NULL)
  );

ALTER TABLE address_allocation_journal
  DROP CONSTRAINT IF EXISTS address_allocation_journal_authorization_id_fkey;
ALTER TABLE address_allocation_journal
  ADD CONSTRAINT address_allocation_journal_authorization_id_fkey
  FOREIGN KEY (authorization_id) REFERENCES authorization_records(authorization_id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS address_allocation_recovery_queue
  ON address_allocation_journal(journal_phase, updated_at)
  WHERE journal_phase IN ('JOURNALED','DERIVATION_STARTED','RPC_UNCERTAIN','DERIVED','RECOVERY_REQUIRED');

INSERT INTO schema_migrations(version) VALUES ('004_crash_safe_address_allocation') ON CONFLICT DO NOTHING;
COMMIT;
