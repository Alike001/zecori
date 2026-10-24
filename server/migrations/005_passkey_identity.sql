BEGIN;

CREATE TABLE IF NOT EXISTS users (
  user_id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  status text NOT NULL CHECK (status IN ('PENDING','ACTIVE','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz
);

CREATE TABLE IF NOT EXISTS passkey_credentials (
  credential_id text PRIMARY KEY CHECK (char_length(credential_id) BETWEEN 16 AND 2048),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  public_key bytea NOT NULL,
  counter bigint NOT NULL CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  device_type text NOT NULL CHECK (device_type IN ('singleDevice','multiDevice')),
  backed_up boolean NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS passkey_credentials_user_active
  ON passkey_credentials(user_id, created_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  challenge_id uuid PRIMARY KEY,
  ceremony text NOT NULL CHECK (ceremony IN ('REGISTRATION','AUTHENTICATION')),
  challenge text NOT NULL UNIQUE,
  user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  consumed_at timestamptz,
  CHECK ((ceremony = 'REGISTRATION') = (user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS webauthn_challenges_expiry
  ON webauthn_challenges(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS user_sessions (
  session_hash bytea PRIMARY KEY CHECK (octet_length(session_hash) = 32),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  csrf_hash bytea NOT NULL CHECK (octet_length(csrf_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS user_sessions_user_active
  ON user_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS identity_audit_events (
  event_id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'ACCOUNT_REGISTERED','PASSKEY_ADDED','LOGIN_SUCCEEDED','SESSION_ROTATED','SESSION_REVOKED'
  )),
  credential_fingerprint bytea,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION reject_identity_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'identity audit events are append-only'; END $$;
DROP TRIGGER IF EXISTS identity_audit_events_append_only ON identity_audit_events;
CREATE TRIGGER identity_audit_events_append_only BEFORE UPDATE OR DELETE ON identity_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_identity_audit_mutation();

INSERT INTO schema_migrations(version) VALUES ('005_passkey_identity') ON CONFLICT DO NOTHING;
COMMIT;
