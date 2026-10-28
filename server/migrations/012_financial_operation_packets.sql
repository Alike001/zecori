BEGIN;

-- Variable quote requests remain internal/non-executable, but use the same durable owner,
-- destination-intent, and verified wallet-control evidence boundary as the fixed route.
ALTER TABLE destination_intents DROP CONSTRAINT IF EXISTS destination_intents_route_id_check;
ALTER TABLE destination_intents DROP CONSTRAINT IF EXISTS destination_intents_amount_atomic_check;
ALTER TABLE destination_intents
  ADD CONSTRAINT destination_intents_route_id_check CHECK (route_id IN (
    'zcash-testnet-to-base-sepolia-fixed', 'zcash-testnet-to-base-sepolia-variable-test-disabled'
  )),
  ADD CONSTRAINT destination_intents_amount_atomic_check CHECK (amount_atomic > 0);

ALTER TABLE test_variable_quote_reservations
  ADD COLUMN owner_user_id uuid REFERENCES users(user_id) ON DELETE RESTRICT,
  ADD COLUMN destination_intent_id uuid REFERENCES destination_intents(intent_id) ON DELETE RESTRICT,
  ADD COLUMN recipient_fingerprint bytea CHECK (recipient_fingerprint IS NULL OR octet_length(recipient_fingerprint)=32);
ALTER TABLE test_variable_quote_reservations
  ADD CONSTRAINT test_variable_quote_owner_request_fk FOREIGN KEY(order_id) REFERENCES public_order_requests(request_id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION require_test_quote_owner_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matched boolean;
BEGIN
  IF NEW.owner_user_id IS NULL OR NEW.destination_intent_id IS NULL OR NEW.recipient_fingerprint IS NULL THEN
    RAISE EXCEPTION 'test quote requires an owner request and verified destination intent';
  END IF;
  SELECT true INTO matched
  FROM public_order_requests r
  JOIN destination_intents d ON d.request_id=r.request_id AND d.owner_user_id=r.owner_user_id
  JOIN destination_wallet_proofs p ON p.intent_id=d.intent_id AND p.owner_user_id=d.owner_user_id
  WHERE r.request_id=NEW.order_id AND r.owner_user_id=NEW.owner_user_id
    AND r.status='AWAITING_OPERATOR' AND r.expires_at>NEW.created_at
    AND d.intent_id=NEW.destination_intent_id AND d.status='CONFIRMED'
    AND d.route_id='zcash-testnet-to-base-sepolia-variable-test-disabled'
    AND d.chain_id=NEW.destination_chain_id
    AND lower(d.token_contract)=lower(NEW.destination_token_contract)
    AND d.amount_atomic=NEW.destination_atomic
    AND d.recipient_fingerprint=NEW.recipient_fingerprint
    AND p.verification_status='VERIFIED'
    AND (r.immutable_terms->>'sourceAtomic')::numeric=NEW.source_atomic
    AND (r.immutable_terms->>'destinationAtomic')::numeric=NEW.destination_atomic
    AND r.immutable_terms->>'rateApprovalId'=NEW.approval_id;
  IF matched IS DISTINCT FROM true THEN RAISE EXCEPTION 'test quote owner/request/proof terms do not match'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_quote_requires_owner_binding
  BEFORE INSERT ON test_variable_quote_reservations FOR EACH ROW EXECUTE FUNCTION require_test_quote_owner_binding();
CREATE OR REPLACE FUNCTION guard_test_quote_owner_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.destination_intent_id IS DISTINCT FROM OLD.destination_intent_id
    OR NEW.recipient_fingerprint IS DISTINCT FROM OLD.recipient_fingerprint THEN RAISE EXCEPTION 'test quote owner binding is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER test_quote_owner_binding_immutable BEFORE UPDATE ON test_variable_quote_reservations FOR EACH ROW EXECUTE FUNCTION guard_test_quote_owner_binding();

CREATE TABLE source_payment_operation_packets (
  operation_id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE RESTRICT,
  packet_digest bytea NOT NULL UNIQUE CHECK (octet_length(packet_digest)=32),
  encrypted_packet bytea NOT NULL,
  encryption_key_version integer NOT NULL CHECK (encryption_key_version>0),
  state text NOT NULL CHECK (state IN ('PREPARED','OPID_RECORDED','SUBMISSION_AMBIGUOUS','TXID_RECORDED','RECOVERY_REQUIRED','CANCELLED')),
  opid_fingerprint bytea UNIQUE CHECK (opid_fingerprint IS NULL OR octet_length(opid_fingerprint)=32),
  encrypted_opid bytea,
  txid_fingerprint bytea UNIQUE CHECK (txid_fingerprint IS NULL OR octet_length(txid_fingerprint)=32),
  encrypted_txid bytea,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((opid_fingerprint IS NULL)=(encrypted_opid IS NULL)),
  CHECK ((txid_fingerprint IS NULL)=(encrypted_txid IS NULL))
);

CREATE TABLE base_payout_signing_packets (
  packet_id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE RESTRICT,
  authorization_id uuid NOT NULL UNIQUE REFERENCES authorization_records(authorization_id) ON DELETE RESTRICT,
  chain_id integer NOT NULL CHECK (chain_id=84532),
  sender text NOT NULL CHECK (sender ~ '^0x[0-9A-Fa-f]{40}$'),
  sender_confirmed_at timestamptz NOT NULL,
  sender_confirmation_source text NOT NULL CHECK (sender_confirmation_source='interactive-metamask'),
  token_contract text NOT NULL CHECK (lower(token_contract)=lower('0x036CbD53842c5426634e7929541eC2318f3dCF7e')),
  recipient text NOT NULL CHECK (recipient ~ '^0x[0-9A-Fa-f]{40}$'),
  amount_atomic numeric(78,0) NOT NULL CHECK (amount_atomic>0),
  nonce bigint NOT NULL CHECK (nonce>=0),
  gas_limit numeric(78,0) NOT NULL CHECK (gas_limit>0),
  max_fee_per_gas numeric(78,0) NOT NULL CHECK (max_fee_per_gas>0),
  max_priority_fee_per_gas numeric(78,0) NOT NULL CHECK (max_priority_fee_per_gas>0 AND max_priority_fee_per_gas<=max_fee_per_gas),
  calldata text NOT NULL CHECK (calldata ~ '^0x[0-9A-Fa-f]+$'),
  packet_digest bytea NOT NULL UNIQUE CHECK (octet_length(packet_digest)=32),
  state text NOT NULL CHECK (state IN ('PREPARED','SIGNED','SUBMITTED','RECOVERY_REQUIRED','CANCELLED','CONFIRMED')),
  signed_transaction_hash bytea UNIQUE CHECK (signed_transaction_hash IS NULL OR octet_length(signed_transaction_hash)=32),
  signed_raw_fingerprint bytea UNIQUE CHECK (signed_raw_fingerprint IS NULL OR octet_length(signed_raw_fingerprint)=32),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at>created_at),
  updated_at timestamptz NOT NULL,
  UNIQUE(chain_id,sender,nonce),
  CHECK ((state NOT IN ('SIGNED','SUBMITTED','CONFIRMED')) OR (signed_transaction_hash IS NOT NULL AND signed_raw_fingerprint IS NOT NULL))
);

-- The current public route cannot create variable orders. If that internal route is
-- accepted in a future reviewed release, its payout packet must consume the same quote.
CREATE OR REPLACE FUNCTION require_base_packet_quote_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quote_record test_variable_quote_reservations%ROWTYPE;
BEGIN
  SELECT * INTO quote_record FROM test_variable_quote_reservations WHERE order_id=NEW.order_id;
  IF FOUND AND (quote_record.status<>'CONSUMED'
    OR quote_record.destination_chain_id<>NEW.chain_id
    OR lower(quote_record.destination_token_contract)<>lower(NEW.token_contract)
    OR quote_record.destination_recipient<>NEW.recipient
    OR quote_record.destination_atomic<>NEW.amount_atomic) THEN
    RAISE EXCEPTION 'payout packet does not match the consumed owner-bound variable quote';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER base_packet_requires_consumed_quote
  BEFORE INSERT ON base_payout_signing_packets FOR EACH ROW EXECUTE FUNCTION require_base_packet_quote_binding();

CREATE OR REPLACE FUNCTION guard_source_payment_operation_packet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.packet_digest IS DISTINCT FROM OLD.packet_digest
    OR NEW.encrypted_packet IS DISTINCT FROM OLD.encrypted_packet OR NEW.encryption_key_version IS DISTINCT FROM OLD.encryption_key_version OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'source payment packet binding is immutable';
  END IF;
  IF (OLD.opid_fingerprint IS NOT NULL AND (NEW.opid_fingerprint IS DISTINCT FROM OLD.opid_fingerprint OR NEW.encrypted_opid IS DISTINCT FROM OLD.encrypted_opid))
    OR (OLD.txid_fingerprint IS NOT NULL AND (NEW.txid_fingerprint IS DISTINCT FROM OLD.txid_fingerprint OR NEW.encrypted_txid IS DISTINCT FROM OLD.encrypted_txid)) THEN
    RAISE EXCEPTION 'source payment operation evidence is immutable';
  END IF;
  IF NOT ((OLD.state='PREPARED' AND NEW.state IN ('OPID_RECORDED','SUBMISSION_AMBIGUOUS','CANCELLED'))
    OR (OLD.state IN ('OPID_RECORDED','SUBMISSION_AMBIGUOUS') AND NEW.state IN ('TXID_RECORDED','RECOVERY_REQUIRED'))
    OR (OLD.state='RECOVERY_REQUIRED' AND NEW.state='TXID_RECORDED')
    OR NEW.state=OLD.state) THEN RAISE EXCEPTION 'invalid source payment operation transition'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER source_payment_packet_guard BEFORE UPDATE ON source_payment_operation_packets FOR EACH ROW EXECUTE FUNCTION guard_source_payment_operation_packet();

CREATE OR REPLACE FUNCTION guard_base_payout_signing_packet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.packet_id IS DISTINCT FROM OLD.packet_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id
    OR NEW.chain_id IS DISTINCT FROM OLD.chain_id OR NEW.sender IS DISTINCT FROM OLD.sender OR NEW.token_contract IS DISTINCT FROM OLD.token_contract
    OR NEW.sender_confirmed_at IS DISTINCT FROM OLD.sender_confirmed_at OR NEW.sender_confirmation_source IS DISTINCT FROM OLD.sender_confirmation_source
    OR NEW.recipient IS DISTINCT FROM OLD.recipient OR NEW.amount_atomic IS DISTINCT FROM OLD.amount_atomic OR NEW.nonce IS DISTINCT FROM OLD.nonce
    OR NEW.gas_limit IS DISTINCT FROM OLD.gas_limit OR NEW.max_fee_per_gas IS DISTINCT FROM OLD.max_fee_per_gas
    OR NEW.max_priority_fee_per_gas IS DISTINCT FROM OLD.max_priority_fee_per_gas OR NEW.calldata IS DISTINCT FROM OLD.calldata
    OR NEW.packet_digest IS DISTINCT FROM OLD.packet_digest OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'base payout signing packet binding is immutable';
  END IF;
  IF (OLD.signed_transaction_hash IS NOT NULL AND NEW.signed_transaction_hash IS DISTINCT FROM OLD.signed_transaction_hash)
    OR (OLD.signed_raw_fingerprint IS NOT NULL AND NEW.signed_raw_fingerprint IS DISTINCT FROM OLD.signed_raw_fingerprint) THEN
    RAISE EXCEPTION 'signed payout transaction evidence is immutable';
  END IF;
  IF NOT ((OLD.state='PREPARED' AND NEW.state IN ('SIGNED','RECOVERY_REQUIRED','CANCELLED'))
    OR (OLD.state='SIGNED' AND NEW.state IN ('SUBMITTED','RECOVERY_REQUIRED'))
    OR (OLD.state='SUBMITTED' AND NEW.state IN ('CONFIRMED','RECOVERY_REQUIRED'))
    OR (OLD.state='RECOVERY_REQUIRED' AND NEW.state IN ('SUBMITTED','CONFIRMED')) OR NEW.state=OLD.state) THEN
    RAISE EXCEPTION 'invalid base payout packet transition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER base_payout_packet_guard BEFORE UPDATE ON base_payout_signing_packets FOR EACH ROW EXECUTE FUNCTION guard_base_payout_signing_packet();

INSERT INTO schema_migrations(version) VALUES ('012_financial_operation_packets') ON CONFLICT DO NOTHING;
COMMIT;
