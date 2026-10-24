BEGIN;

CREATE TABLE IF NOT EXISTS staging_keyring_canary (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  encrypted_canary bytea NOT NULL,
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  plaintext_digest bytea NOT NULL CHECK (octet_length(plaintext_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(version) VALUES ('006_staging_keyring_canary') ON CONFLICT DO NOTHING;
COMMIT;
