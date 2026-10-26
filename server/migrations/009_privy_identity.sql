BEGIN;

CREATE TABLE IF NOT EXISTS external_identities (
  identity_id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('PRIVY')),
  subject_fingerprint bytea NOT NULL CHECK (octet_length(subject_fingerprint) = 32),
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by text NOT NULL CHECK (linked_by IN ('PRIVY_SIGN_IN','AUTHENTICATED_LINK')),
  UNIQUE (provider, subject_fingerprint),
  UNIQUE (provider, user_id)
);
CREATE INDEX IF NOT EXISTS external_identities_user ON external_identities(user_id);

ALTER TABLE identity_audit_events DROP CONSTRAINT IF EXISTS identity_audit_events_event_type_check;
ALTER TABLE identity_audit_events ADD CONSTRAINT identity_audit_events_event_type_check CHECK (event_type IN (
  'ACCOUNT_REGISTERED','PASSKEY_ADDED','LOGIN_SUCCEEDED','SESSION_ROTATED','SESSION_REVOKED',
  'PRIVY_ACCOUNT_CREATED','PRIVY_IDENTITY_LINKED','PRIVY_LOGIN_SUCCEEDED'
));

INSERT INTO schema_migrations(version) VALUES ('009_privy_identity') ON CONFLICT DO NOTHING;
COMMIT;
