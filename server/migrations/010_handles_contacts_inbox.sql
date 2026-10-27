BEGIN;

CREATE TABLE account_handles (
  handle_id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE RESTRICT,
  normalized_handle text NOT NULL UNIQUE CHECK (normalized_handle ~ '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' AND char_length(normalized_handle) BETWEEN 3 AND 24),
  display_handle text NOT NULL CHECK (char_length(display_handle) BETWEEN 3 AND 24),
  status text NOT NULL CHECK (status IN ('ACTIVE','LOCKED','RETIRED')),
  discoverable boolean NOT NULL DEFAULT false,
  version bigint NOT NULL CHECK (version > 0),
  claimed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  renamed_at timestamptz,
  retired_at timestamptz,
  reuse_after timestamptz
);

CREATE TABLE reserved_handles (
  normalized_handle text PRIMARY KEY,
  reason_code text NOT NULL CHECK (char_length(reason_code) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

INSERT INTO reserved_handles(normalized_handle,reason_code) VALUES
  ('admin','SYSTEM_ROLE'),('administrator','SYSTEM_ROLE'),('api','SYSTEM_ROUTE'),('app','SYSTEM_ROUTE'),
  ('help','IMPERSONATION_RISK'),('support','IMPERSONATION_RISK'),('security','IMPERSONATION_RISK'),
  ('zecori','BRAND'),('zecathon','BRAND'),('zcash','CHAIN'),('base','CHAIN'),('usdc','ASSET'),
  ('operator','SYSTEM_ROLE'),('system','SYSTEM_ROLE'),('root','SYSTEM_ROLE'),('null','SYSTEM_TERM'),
  ('settings','SYSTEM_ROUTE'),('inbox','SYSTEM_ROUTE'),('account','SYSTEM_ROUTE'),('assistant','SYSTEM_ROUTE')
ON CONFLICT DO NOTHING;

CREATE TABLE handle_history (
  history_id uuid PRIMARY KEY,
  handle_id uuid NOT NULL REFERENCES account_handles(handle_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  normalized_handle text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CLAIMED','RENAMED_FROM','RENAMED_TO','DISCOVERABILITY_CHANGED','RETIRED','LOCKED')),
  version bigint NOT NULL CHECK (version > 0),
  occurred_at timestamptz NOT NULL,
  reuse_after timestamptz,
  reason_code text NOT NULL CHECK (char_length(reason_code) BETWEEN 1 AND 40)
);
CREATE INDEX handle_history_reuse ON handle_history(normalized_handle,reuse_after DESC);
CREATE INDEX handle_history_owner ON handle_history(user_id,occurred_at DESC);

CREATE OR REPLACE FUNCTION reject_handle_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'handle history is append-only'; END $$;
CREATE TRIGGER handle_history_append_only BEFORE UPDATE OR DELETE ON handle_history
  FOR EACH ROW EXECUTE FUNCTION reject_handle_history_mutation();

CREATE TABLE handle_lookup_attempts (
  attempt_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  candidate_fingerprint bytea NOT NULL CHECK (octet_length(candidate_fingerprint)=32),
  purpose text NOT NULL CHECK (purpose IN ('AVAILABILITY','CONTACT','REQUEST_INTENT')),
  outcome text NOT NULL CHECK (outcome IN ('AVAILABLE','UNAVAILABLE','RATE_LIMITED')),
  occurred_at timestamptz NOT NULL
);
CREATE INDEX handle_lookup_attempts_rate ON handle_lookup_attempts(user_id,occurred_at DESC);

CREATE TABLE private_contacts (
  contact_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  target_handle_id uuid NOT NULL REFERENCES account_handles(handle_id) ON DELETE RESTRICT,
  encrypted_label bytea NOT NULL,
  encryption_key_version integer NOT NULL CHECK (encryption_key_version > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE','REMOVED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX private_contacts_active_target ON private_contacts(owner_user_id,target_handle_id) WHERE status='ACTIVE';
CREATE INDEX private_contacts_owner ON private_contacts(owner_user_id,updated_at DESC);

CREATE TABLE handle_request_intents (
  intent_id uuid PRIMARY KEY,
  requester_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  recipient_handle_id uuid NOT NULL REFERENCES account_handles(handle_id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL REFERENCES private_contacts(contact_id) ON DELETE RESTRICT,
  route_id text NOT NULL CHECK (route_id='zcash-testnet-to-base-sepolia-fixed'),
  status text NOT NULL CHECK (status IN ('REQUESTED','ACCEPTED','DECLINED','CANCELLED','EXPIRED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  responded_at timestamptz
);
CREATE INDEX handle_request_recipient ON handle_request_intents(recipient_handle_id,status,created_at DESC);
CREATE INDEX handle_request_requester ON handle_request_intents(requester_user_id,created_at DESC);

CREATE TABLE transactional_outbox (
  outbox_id uuid PRIMARY KEY,
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('ORDER_REQUEST','HANDLE','HANDLE_REQUEST')),
  aggregate_id uuid NOT NULL,
  aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
  event_type text NOT NULL,
  recipient_user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  privacy_class text NOT NULL CHECK (privacy_class='OWNER_PRIVATE_REDACTED'),
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','PROCESSING','DELIVERED','RETRY','DEAD')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  delivered_at timestamptz,
  UNIQUE(aggregate_type,aggregate_id,aggregate_version,event_type,recipient_user_id),
  CHECK (NOT (payload ?| ARRAY['recipient','address','destinationRecipient','receiver','signature','transactionHash','txid','email']))
);
CREATE INDEX transactional_outbox_claim ON transactional_outbox(status,available_at,occurred_at)
  WHERE status IN ('PENDING','RETRY','PROCESSING');

CREATE TABLE inbox_items (
  inbox_item_id uuid PRIMARY KEY,
  outbox_id uuid NOT NULL UNIQUE REFERENCES transactional_outbox(outbox_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('ORDER','HANDLE','REQUEST')),
  title_key text NOT NULL,
  body_variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id uuid,
  created_at timestamptz NOT NULL,
  read_at timestamptz,
  archived_at timestamptz,
  CHECK (NOT (body_variables ?| ARRAY['recipient','address','destinationRecipient','receiver','signature','transactionHash','txid','email']))
);
CREATE INDEX inbox_items_owner_unread ON inbox_items(user_id,read_at,created_at DESC) WHERE archived_at IS NULL;

CREATE TABLE notification_delivery_attempts (
  attempt_id uuid PRIMARY KEY,
  outbox_id uuid NOT NULL REFERENCES transactional_outbox(outbox_id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel='IN_APP'),
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  outcome_code text NOT NULL,
  next_retry_at timestamptz,
  UNIQUE(outbox_id,attempt_number)
);

CREATE OR REPLACE FUNCTION reject_notification_attempt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'notification attempts are append-only'; END $$;
CREATE TRIGGER notification_attempts_append_only BEFORE UPDATE OR DELETE ON notification_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION reject_notification_attempt_mutation();

CREATE OR REPLACE FUNCTION enqueue_order_request_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_version bigint; next_event text;
BEGIN
  IF NEW.owner_user_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN next_event := 'REQUEST_RECEIVED';
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW;
  ELSE
    next_event := CASE NEW.status
      WHEN 'PAYMENT_READY' THEN 'PAYMENT_INSTRUCTIONS_PUBLISHED'
      WHEN 'SOURCE_DETECTED' THEN 'SOURCE_DETECTED'
      WHEN 'SOURCE_CONFIRMED' THEN 'SOURCE_CONFIRMED'
      WHEN 'PAYOUT_AWAITING_APPROVAL' THEN 'PAYOUT_AWAITING_APPROVAL'
      WHEN 'PAYOUT_SUBMITTED' THEN 'PAYOUT_SUBMITTED'
      WHEN 'FAILED' THEN 'FAILED' WHEN 'UNRESOLVED' THEN 'UNRESOLVED'
      WHEN 'EXPIRED' THEN 'EXPIRED' WHEN 'CANCELLED' THEN 'CANCELLED'
      WHEN 'REFUND_PENDING' THEN 'REFUND_PENDING' WHEN 'REFUNDED' THEN 'REFUNDED'
      ELSE NULL END;
  END IF;
  IF next_event IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(max(aggregate_version),0)+1 INTO next_version FROM transactional_outbox
    WHERE aggregate_type='ORDER_REQUEST' AND aggregate_id=NEW.request_id;
  INSERT INTO transactional_outbox(outbox_id,aggregate_type,aggregate_id,aggregate_version,event_type,recipient_user_id,privacy_class,payload,occurred_at,available_at,status)
    VALUES(gen_random_uuid(),'ORDER_REQUEST',NEW.request_id,next_version,next_event,NEW.owner_user_id,'OWNER_PRIVATE_REDACTED',jsonb_build_object('requestId',NEW.request_id,'status',NEW.status),now(),now(),'PENDING');
  RETURN NEW;
END $$;
CREATE TRIGGER public_order_request_notification AFTER INSERT OR UPDATE OF status ON public_order_requests
  FOR EACH ROW EXECUTE FUNCTION enqueue_order_request_notification();

CREATE OR REPLACE FUNCTION enqueue_final_receipt_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_record record; next_version bigint;
BEGIN
  SELECT r.request_id,r.owner_user_id INTO request_record FROM orders o JOIN public_order_requests r ON r.request_id=o.request_id WHERE o.order_id=NEW.order_id;
  IF request_record.owner_user_id IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(max(aggregate_version),0)+1 INTO next_version FROM transactional_outbox
    WHERE aggregate_type='ORDER_REQUEST' AND aggregate_id=request_record.request_id;
  INSERT INTO transactional_outbox(outbox_id,aggregate_type,aggregate_id,aggregate_version,event_type,recipient_user_id,privacy_class,payload,occurred_at,available_at,status)
    VALUES(gen_random_uuid(),'ORDER_REQUEST',request_record.request_id,next_version,'FINAL_RECEIPT_CREATED',request_record.owner_user_id,'OWNER_PRIVATE_REDACTED',jsonb_build_object('requestId',request_record.request_id,'status','COMPLETED'),NEW.created_at,NEW.created_at,'PENDING');
  RETURN NEW;
END $$;
CREATE TRIGGER final_receipt_notification AFTER INSERT ON receipts
  FOR EACH ROW EXECUTE FUNCTION enqueue_final_receipt_notification();

INSERT INTO schema_migrations(version) VALUES ('010_handles_contacts_inbox') ON CONFLICT DO NOTHING;
COMMIT;
