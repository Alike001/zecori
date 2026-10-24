BEGIN;

ALTER TABLE public_order_requests DROP CONSTRAINT IF EXISTS public_order_requests_status_check;
ALTER TABLE public_order_requests DROP CONSTRAINT IF EXISTS public_order_requests_check;
ALTER TABLE public_order_requests DROP CONSTRAINT IF EXISTS public_order_requests_check1;
ALTER TABLE public_order_requests DROP CONSTRAINT IF EXISTS public_order_requests_check2;
ALTER TABLE public_order_requests DROP CONSTRAINT IF EXISTS public_order_requests_check3;
ALTER TABLE public_order_requests DROP CONSTRAINT IF EXISTS public_order_requests_check4;
ALTER TABLE public_order_requests
  ADD CONSTRAINT public_order_requests_status_check CHECK (status IN (
    'AWAITING_OPERATOR','ACCEPTED','PAYMENT_READY','SOURCE_DETECTED','SOURCE_CONFIRMED',
    'PAYOUT_AWAITING_APPROVAL','PAYOUT_SUBMITTED','COMPLETED','FAILED',
    'REFUND_PENDING','REFUNDED','UNRESOLVED','EXPIRED','CANCELLED'
  )),
  ADD CONSTRAINT public_order_request_expiry_check CHECK (expires_at > created_at),
  ADD CONSTRAINT public_order_request_destination_check CHECK (destination_recipient ~ '^0x[0-9A-Fa-f]{40}$'),
  ADD CONSTRAINT public_order_request_link_check CHECK (
    (status IN ('AWAITING_OPERATOR','EXPIRED','CANCELLED')) = (linked_order_id IS NULL)
  ),
  ADD CONSTRAINT public_order_request_instruction_check CHECK (
    encrypted_payment_receiver IS NULL OR status NOT IN ('AWAITING_OPERATOR','ACCEPTED','EXPIRED','CANCELLED')
  ),
  ADD CONSTRAINT public_order_request_encryption_check CHECK (
    (encrypted_payment_receiver IS NULL) = (payment_receiver_key_version IS NULL)
  );

ALTER TABLE public_order_requests
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by text,
  ADD COLUMN IF NOT EXISTS manifest_signature bytea;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS request_id uuid UNIQUE REFERENCES public_order_requests(request_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS manifest_signature bytea NOT NULL DEFAULT '\\x'::bytea,
  ADD COLUMN IF NOT EXISTS accepted_by text NOT NULL DEFAULT 'legacy-unlinked';
ALTER TABLE orders ALTER COLUMN manifest_signature DROP DEFAULT;
ALTER TABLE orders ALTER COLUMN accepted_by DROP DEFAULT;

ALTER TABLE address_allocation_journal
  ADD COLUMN IF NOT EXISTS encryption_key_version integer CHECK (encryption_key_version > 0),
  ADD COLUMN IF NOT EXISTS source_not_before_height integer CHECK (source_not_before_height > 0),
  ADD COLUMN IF NOT EXISTS authorization_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS one_allocation_authorization
  ON address_allocation_journal(authorization_id) WHERE authorization_id IS NOT NULL;

ALTER TABLE authorization_records
  ADD COLUMN IF NOT EXISTS target text,
  ADD COLUMN IF NOT EXISTS signed_payload jsonb,
  ADD COLUMN IF NOT EXISTS signature bytea,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE settlement_evidence
  ADD COLUMN IF NOT EXISTS encryption_key_version integer CHECK (encryption_key_version > 0);
ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS encryption_key_version integer CHECK (encryption_key_version > 0),
  ADD COLUMN IF NOT EXISTS authenticity_hmac bytea;

CREATE UNIQUE INDEX IF NOT EXISTS one_live_address_authorization
  ON authorization_records(order_id, kind) WHERE kind = 'ADDRESS_ALLOCATION' AND state = 'ISSUED';
CREATE UNIQUE INDEX IF NOT EXISTS one_payout_reference_per_order
  ON settlement_evidence(order_id) WHERE chain = 'base-sepolia';
CREATE UNIQUE INDEX IF NOT EXISTS one_source_reference_per_order
  ON settlement_evidence(order_id) WHERE chain = 'zcash-testnet';

CREATE TABLE IF NOT EXISTS replay_references (
  chain text NOT NULL CHECK (chain IN ('zcash-testnet','base-sepolia')),
  reference_fingerprint bytea NOT NULL,
  order_id uuid NOT NULL REFERENCES orders(order_id) ON DELETE RESTRICT,
  reference_kind text NOT NULL CHECK (reference_kind IN ('SOURCE_OUTPUT','PAYOUT_TRANSACTION')),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, reference_fingerprint),
  UNIQUE (order_id, reference_kind)
);

CREATE OR REPLACE FUNCTION reject_immutable_order_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.immutable_manifest IS DISTINCT FROM OLD.immutable_manifest
     OR NEW.owner_session_hash IS DISTINCT FROM OLD.owner_session_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.manifest_signature IS DISTINCT FROM OLD.manifest_signature
     OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by THEN
    RAISE EXCEPTION 'immutable order fields cannot be changed';
  END IF;
  IF NEW.state_version <> OLD.state_version + 1 THEN RAISE EXCEPTION 'order state version must advance exactly once'; END IF;
  RETURN NEW;
END $$;

INSERT INTO schema_migrations(version) VALUES ('002_settlement_integration') ON CONFLICT DO NOTHING;
COMMIT;
