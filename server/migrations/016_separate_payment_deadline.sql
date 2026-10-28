BEGIN;

-- Request expiry remains the operator-acceptance/quote boundary. The order's
-- existing expires_at is its shielded payment deadline and is never rewritten.
CREATE OR REPLACE FUNCTION reject_immutable_order_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.immutable_manifest IS DISTINCT FROM OLD.immutable_manifest
     OR NEW.owner_session_hash IS DISTINCT FROM OLD.owner_session_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.manifest_signature IS DISTINCT FROM OLD.manifest_signature
     OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by THEN
    RAISE EXCEPTION 'immutable order fields cannot be changed';
  END IF;
  IF NEW.state_version <> OLD.state_version + 1 THEN RAISE EXCEPTION 'order state version must advance exactly once'; END IF;
  RETURN NEW;
END $$;

INSERT INTO schema_migrations(version) VALUES ('016_separate_payment_deadline') ON CONFLICT DO NOTHING;
COMMIT;
