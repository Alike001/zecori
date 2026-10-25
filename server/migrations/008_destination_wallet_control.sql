BEGIN;

CREATE TABLE destination_wallet_challenges (
  challenge_id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES destination_intents(intent_id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  session_hash bytea NOT NULL CHECK (octet_length(session_hash) = 32),
  recipient_fingerprint bytea NOT NULL CHECK (octet_length(recipient_fingerprint) = 32),
  nonce_hash bytea NOT NULL UNIQUE CHECK (octet_length(nonce_hash) = 32),
  encrypted_challenge bytea NOT NULL,
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  consumed_at timestamptz,
  status text NOT NULL CHECK (status IN ('ISSUED','VERIFYING','VERIFIED','REJECTED','EXPIRED')),
  UNIQUE(challenge_id, intent_id, owner_user_id)
);
CREATE INDEX destination_wallet_challenges_open ON destination_wallet_challenges(intent_id, expires_at) WHERE status='ISSUED';

CREATE OR REPLACE FUNCTION guard_destination_wallet_challenge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.challenge_id IS DISTINCT FROM OLD.challenge_id OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.session_hash IS DISTINCT FROM OLD.session_hash
    OR NEW.recipient_fingerprint IS DISTINCT FROM OLD.recipient_fingerprint OR NEW.nonce_hash IS DISTINCT FROM OLD.nonce_hash
    OR NEW.encrypted_challenge IS DISTINCT FROM OLD.encrypted_challenge OR NEW.encryption_key_version IS DISTINCT FROM OLD.encryption_key_version
    OR NEW.issued_at IS DISTINCT FROM OLD.issued_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'wallet-control challenge binding is immutable';
  END IF;
  IF OLD.status = 'ISSUED' AND NEW.status NOT IN ('VERIFYING','EXPIRED') THEN RAISE EXCEPTION 'invalid wallet-control challenge transition'; END IF;
  IF OLD.status = 'VERIFYING' AND NEW.status NOT IN ('VERIFIED','REJECTED') THEN RAISE EXCEPTION 'invalid wallet-control challenge transition'; END IF;
  IF OLD.status IN ('VERIFIED','REJECTED','EXPIRED') AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'terminal wallet-control challenge cannot transition'; END IF;
  IF NEW.status <> 'ISSUED' AND NEW.consumed_at IS NULL THEN RAISE EXCEPTION 'consumed wallet-control challenge requires a timestamp'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER destination_wallet_challenge_guard BEFORE UPDATE ON destination_wallet_challenges FOR EACH ROW EXECUTE FUNCTION guard_destination_wallet_challenge();

CREATE TABLE destination_wallet_proofs (
  proof_id uuid PRIMARY KEY,
  challenge_id uuid NOT NULL UNIQUE,
  intent_id uuid NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL,
  recipient_fingerprint bytea NOT NULL CHECK (octet_length(recipient_fingerprint) = 32),
  method text NOT NULL CHECK (method IN ('EIP712_EOA','ERC1271')),
  signature_fingerprint bytea NOT NULL UNIQUE CHECK (octet_length(signature_fingerprint) = 32),
  typed_data_digest bytea NOT NULL UNIQUE CHECK (octet_length(typed_data_digest) = 32),
  encrypted_proof bytea NOT NULL,
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  verification_status text NOT NULL CHECK (verification_status IN ('VERIFIED','RECHECK_FAILED')),
  verified_at timestamptz NOT NULL,
  verified_block_number bigint NOT NULL CHECK (verified_block_number >= 0),
  verified_block_hash bytea NOT NULL CHECK (octet_length(verified_block_hash) = 32),
  last_checked_at timestamptz NOT NULL,
  FOREIGN KEY (challenge_id,intent_id,owner_user_id) REFERENCES destination_wallet_challenges(challenge_id,intent_id,owner_user_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION guard_destination_wallet_proof() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.proof_id IS DISTINCT FROM OLD.proof_id OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
    OR NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.recipient_fingerprint IS DISTINCT FROM OLD.recipient_fingerprint OR NEW.method IS DISTINCT FROM OLD.method
    OR NEW.signature_fingerprint IS DISTINCT FROM OLD.signature_fingerprint OR NEW.typed_data_digest IS DISTINCT FROM OLD.typed_data_digest
    OR NEW.encrypted_proof IS DISTINCT FROM OLD.encrypted_proof OR NEW.encryption_key_version IS DISTINCT FROM OLD.encryption_key_version
    OR NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.verified_block_number IS DISTINCT FROM OLD.verified_block_number
    OR NEW.verified_block_hash IS DISTINCT FROM OLD.verified_block_hash THEN RAISE EXCEPTION 'wallet-control proof evidence is immutable';
  END IF;
  IF OLD.verification_status = 'RECHECK_FAILED' AND NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN RAISE EXCEPTION 'failed wallet-control proof cannot be restored'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER destination_wallet_proof_guard BEFORE UPDATE ON destination_wallet_proofs FOR EACH ROW EXECUTE FUNCTION guard_destination_wallet_proof();

CREATE TABLE destination_wallet_audit_events (
  event_id bigserial PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES destination_intents(intent_id) ON DELETE RESTRICT,
  challenge_id uuid REFERENCES destination_wallet_challenges(challenge_id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('USER','SYSTEM','VERIFIER','OPERATOR')),
  actor_fingerprint bytea,
  event_type text NOT NULL CHECK (event_type IN ('CHALLENGE_ISSUED','CHALLENGE_CONSUMED','PROOF_VERIFIED','PROOF_REJECTED','PROOF_RECHECKED','PROOF_RECHECK_FAILED')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (NOT (details ?| ARRAY['recipient','address','signature','nonce','typedData']))
);
CREATE OR REPLACE FUNCTION reject_destination_wallet_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'destination wallet audit events are append-only'; END $$;
CREATE TRIGGER destination_wallet_audit_append_only BEFORE UPDATE OR DELETE ON destination_wallet_audit_events FOR EACH ROW EXECUTE FUNCTION reject_destination_wallet_audit_mutation();

INSERT INTO schema_migrations(version) VALUES ('008_destination_wallet_control') ON CONFLICT DO NOTHING;
COMMIT;
