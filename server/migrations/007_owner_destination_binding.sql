BEGIN;

ALTER TABLE public_order_requests RENAME COLUMN destination_recipient TO legacy_destination_recipient;
ALTER TABLE public_order_requests DROP CONSTRAINT IF EXISTS public_order_request_destination_check;
ALTER TABLE public_order_requests ALTER COLUMN legacy_destination_recipient DROP NOT NULL;
ALTER TABLE public_order_requests
  ADD COLUMN owner_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  ADD COLUMN destination_binding_version smallint NOT NULL DEFAULT 1,
  ADD CONSTRAINT public_order_request_owner_binding_unique UNIQUE (request_id, owner_user_id),
  ADD CONSTRAINT public_order_request_binding_shape CHECK (
    (destination_binding_version = 1 AND legacy_destination_recipient ~ '^0x[0-9A-Fa-f]{40}$' AND owner_user_id IS NULL)
    OR (destination_binding_version = 2 AND legacy_destination_recipient IS NULL AND owner_user_id IS NOT NULL)
  );
ALTER TABLE public_order_requests ALTER COLUMN destination_binding_version DROP DEFAULT;

CREATE TABLE destination_intents (
  intent_id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL,
  route_id text NOT NULL CHECK (route_id = 'zcash-testnet-to-base-sepolia-fixed'),
  network text NOT NULL CHECK (network = 'base-sepolia'),
  chain_id bigint NOT NULL CHECK (chain_id = 84532),
  token_contract text NOT NULL CHECK (lower(token_contract) = lower('0x036CbD53842c5426634e7929541eC2318f3dCF7e')),
  amount_atomic numeric(78,0) NOT NULL CHECK (amount_atomic = 1000000),
  recipient_fingerprint bytea NOT NULL CHECK (octet_length(recipient_fingerprint) = 32),
  encrypted_intent bytea NOT NULL,
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  consent_version text NOT NULL CHECK (consent_version = 'base-destination-intent-v1'),
  consent_digest bytea NOT NULL CHECK (octet_length(consent_digest) = 32),
  consent_confirmed_at timestamptz NOT NULL,
  wallet_control_verification text NOT NULL CHECK (wallet_control_verification = 'NOT_PERFORMED'),
  status text NOT NULL CHECK (status IN ('CONFIRMED','BOUND','EXPIRED','REVOKED')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  bound_at timestamptz,
  manifest_fingerprint bytea CHECK (manifest_fingerprint IS NULL OR octet_length(manifest_fingerprint) = 32),
  FOREIGN KEY (request_id, owner_user_id) REFERENCES public_order_requests(request_id, owner_user_id) ON DELETE RESTRICT,
  CHECK ((status = 'BOUND') = (bound_at IS NOT NULL AND manifest_fingerprint IS NOT NULL))
);
CREATE UNIQUE INDEX destination_intents_active_owner_recipient
  ON destination_intents(owner_user_id, recipient_fingerprint) WHERE status = 'CONFIRMED';

CREATE TABLE destination_intent_events (
  event_id bigserial PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES destination_intents(intent_id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('USER','OPERATOR','SYSTEM')),
  actor_fingerprint bytea,
  event_type text NOT NULL CHECK (event_type IN ('INTENT_CONFIRMED','INTENT_BOUND','INTENT_EXPIRED','INTENT_REVOKED')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (NOT (details ?| ARRAY['recipient','address','destinationRecipient']))
);

CREATE OR REPLACE FUNCTION guard_destination_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.intent_id IS DISTINCT FROM OLD.intent_id OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.route_id IS DISTINCT FROM OLD.route_id
    OR NEW.network IS DISTINCT FROM OLD.network OR NEW.chain_id IS DISTINCT FROM OLD.chain_id
    OR NEW.token_contract IS DISTINCT FROM OLD.token_contract OR NEW.amount_atomic IS DISTINCT FROM OLD.amount_atomic
    OR NEW.recipient_fingerprint IS DISTINCT FROM OLD.recipient_fingerprint OR NEW.encrypted_intent IS DISTINCT FROM OLD.encrypted_intent
    OR NEW.encryption_key_version IS DISTINCT FROM OLD.encryption_key_version OR NEW.consent_version IS DISTINCT FROM OLD.consent_version
    OR NEW.consent_digest IS DISTINCT FROM OLD.consent_digest OR NEW.consent_confirmed_at IS DISTINCT FROM OLD.consent_confirmed_at
    OR NEW.wallet_control_verification IS DISTINCT FROM OLD.wallet_control_verification OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN RAISE EXCEPTION 'destination intent evidence is immutable';
  END IF;
  IF OLD.status = 'CONFIRMED' AND NEW.status NOT IN ('BOUND','EXPIRED','REVOKED') THEN RAISE EXCEPTION 'invalid destination intent transition'; END IF;
  IF OLD.status <> 'CONFIRMED' AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'terminal destination intent cannot transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER destination_intents_immutable_guard BEFORE UPDATE ON destination_intents FOR EACH ROW EXECUTE FUNCTION guard_destination_intent();

CREATE OR REPLACE FUNCTION reject_destination_intent_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'destination intent events are append-only'; END $$;
CREATE TRIGGER destination_intent_events_append_only BEFORE UPDATE OR DELETE ON destination_intent_events FOR EACH ROW EXECUTE FUNCTION reject_destination_intent_event_mutation();

INSERT INTO schema_migrations(version) VALUES ('007_owner_destination_binding') ON CONFLICT DO NOTHING;
COMMIT;
