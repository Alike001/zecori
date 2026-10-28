BEGIN;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check CHECK (status IN (
    'CREATED','AWAITING_PAYMENT','SOURCE_DETECTED','SOURCE_CONFIRMED',
    'PAYOUT_AWAITING_APPROVAL','PAYOUT_SUBMITTED','COMPLETED','FAILED',
    'REFUND_PENDING','REFUNDED','UNRESOLVED','EXPIRED'
  ));

ALTER TABLE public_order_requests DROP CONSTRAINT IF EXISTS public_order_request_link_check;
ALTER TABLE public_order_requests
  ADD CONSTRAINT public_order_request_link_check CHECK (
    (status IN ('AWAITING_OPERATOR','CANCELLED') AND linked_order_id IS NULL)
    OR (status = 'EXPIRED' AND (
      (linked_order_id IS NULL AND accepted_at IS NULL)
      OR (linked_order_id = request_id AND accepted_at IS NOT NULL)
    ))
    OR (status NOT IN ('AWAITING_OPERATOR','CANCELLED','EXPIRED') AND linked_order_id IS NOT NULL)
  );

INSERT INTO schema_migrations(version) VALUES ('015_accepted_order_expiry') ON CONFLICT DO NOTHING;
COMMIT;
