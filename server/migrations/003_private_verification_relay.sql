BEGIN;

CREATE TABLE IF NOT EXISTS private_verification_jobs (
  job_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
  verifier_id text NOT NULL CHECK (verifier_id ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  phase text NOT NULL CHECK (phase IN ('SOURCE_DETECTION','SOURCE_CONFIRMATION')),
  manifest_fingerprint bytea NOT NULL CHECK (octet_length(manifest_fingerprint) = 32),
  request_fingerprint bytea NOT NULL CHECK (octet_length(request_fingerprint) = 32),
  challenge_nonce bytea NOT NULL UNIQUE CHECK (octet_length(challenge_nonce) = 32),
  encrypted_challenge bytea NOT NULL,
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  coordinator_signature_fingerprint bytea NOT NULL UNIQUE CHECK (octet_length(coordinator_signature_fingerprint) = 32),
  state text NOT NULL CHECK (state IN ('PENDING','DISPATCHED','RECEIVED','APPLIED','UNRESOLVED','EXPIRED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_expires_at timestamptz,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
  received_at timestamptz,
  applied_at timestamptz,
  unresolved_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, phase)
);
CREATE INDEX IF NOT EXISTS private_verification_jobs_claim
  ON private_verification_jobs(verifier_id, state, issued_at);

CREATE TABLE IF NOT EXISTS private_verification_messages (
  message_id uuid PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE REFERENCES private_verification_jobs(job_id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
  verifier_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('VERIFIED','UNRESOLVED')),
  signature_fingerprint bytea NOT NULL UNIQUE CHECK (octet_length(signature_fingerprint) = 32),
  encrypted_envelope bytea NOT NULL,
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  received_at timestamptz NOT NULL
);

INSERT INTO schema_migrations(version) VALUES ('003_private_verification_relay') ON CONFLICT DO NOTHING;
COMMIT;
