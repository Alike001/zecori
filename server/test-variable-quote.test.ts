import assert from 'node:assert/strict';
import test from 'node:test';
import { DisabledTestVariableQuoteEngine, TEST_VARIABLE_QUOTES_FLAG, type ApprovedTestRate } from './test-variable-quote.ts';

const rate: ApprovedTestRate = {
  providerId: 'approved-test-lp', approvalId: 'approval-2026-10-28-a',
  approvedAt: '2026-10-28T10:00:00.000Z', expiresAt: '2026-10-28T11:00:00.000Z',
  destinationAtomicNumerator: '100', sourceAtomicDenominator: '1',
  feeBps: 25, fixedFeeDestinationAtomic: '7', minimumSourceAtomic: '1000', maximumSourceAtomic: '10000',
  minimumDestinationAtomic: '1',
  liquidityCapacityDestinationAtomic: '199500',
};
const now = Date.parse('2026-10-28T10:15:00.000Z');
const recipientA = '0x1111111111111111111111111111111111111111';
const recipientB = '0x2222222222222222222222222222222222222222';

test('variable quotes are disabled unless the isolated flag is exact', () => {
  assert.equal(DisabledTestVariableQuoteEngine.enabledFromEnvironment({ [TEST_VARIABLE_QUOTES_FLAG]: '1' }), true);
  assert.equal(DisabledTestVariableQuoteEngine.enabledFromEnvironment({ [TEST_VARIABLE_QUOTES_FLAG]: 'true' }), false);
  assert.throws(() => new DisabledTestVariableQuoteEngine({ rate }), /disabled/);
});

test('uses integer atomic amounts with documented floor and ceiling rules', () => {
  const engine = new DisabledTestVariableQuoteEngine({ enabled: true, rate });
  const quote = engine.quote({ orderId: '00000000-0000-4000-8000-000000000001', destinationRecipient: recipientA, sourceAtomic: '1001', now });
  assert.deepEqual({ gross: quote.grossDestinationAtomic, fee: quote.feeDestinationAtomic, destination: quote.destinationAtomic }, { gross: '100100', fee: '258', destination: '99842' });
  assert.equal(quote.rounding, 'gross-floor-fee-ceiling');
  assert.equal(quote.rateKind, 'operator-approved-test-rate-not-market-price');
});

test('binds exactly, reserves capacity once, and returns the same quote idempotently', () => {
  const engine = new DisabledTestVariableQuoteEngine({ enabled: true, rate });
  const input = { orderId: '00000000-0000-4000-8000-000000000002', destinationRecipient: recipientA, sourceAtomic: '1000', now };
  const first = engine.quote(input); const second = engine.quote(input);
  assert.equal(second.quoteId, first.quoteId);
  assert.equal(engine.availableDestinationAtomic, '99757');
  assert.throws(() => engine.quote({ ...input, destinationRecipient: recipientB }), /different immutable terms/);
});

test('prevents capacity double allocation and releases only on expiry', () => {
  const engine = new DisabledTestVariableQuoteEngine({ enabled: true, rate, quoteLifetimeMs: 1_000 });
  engine.quote({ orderId: '00000000-0000-4000-8000-000000000003', destinationRecipient: recipientA, sourceAtomic: '1000', now });
  engine.quote({ orderId: '00000000-0000-4000-8000-000000000004', destinationRecipient: recipientB, sourceAtomic: '1000', now });
  assert.equal(engine.availableDestinationAtomic, '14');
  assert.throws(() => engine.quote({ orderId: '00000000-0000-4000-8000-000000000005', destinationRecipient: recipientA, sourceAtomic: '1000', now }), /capacity/);
  assert.equal(engine.releaseExpired(now + 1_000), 2);
  assert.equal(engine.availableDestinationAtomic, '199500');
});

test('consume requires quote, order, recipient, and active expiry to match', () => {
  const engine = new DisabledTestVariableQuoteEngine({ enabled: true, rate });
  const orderId = '00000000-0000-4000-8000-000000000006';
  const quote = engine.quote({ orderId, destinationRecipient: recipientA, sourceAtomic: '1000', now });
  assert.throws(() => engine.consume({ quoteId: quote.quoteId, orderId, destinationRecipient: recipientB, now }), /exact order and recipient/);
  const consumed = engine.consume({ quoteId: quote.quoteId, orderId, destinationRecipient: recipientA, now });
  assert.equal(consumed.status, 'CONSUMED');
  assert.equal(engine.availableDestinationAtomic, '99757', 'consumed liquidity stays allocated');
  assert.equal(engine.availableDestinationAtomic, '99757');
  assert.throws(() => engine.consume({ quoteId: quote.quoteId, orderId, destinationRecipient: recipientA, now }), /not active/);
  assert.throws(() => engine.quote({ orderId, destinationRecipient: recipientA, sourceAtomic: '1000', now }), /terminal/);
});

test('enforces min, max, approved expiry, fees, and decimal-free inputs', () => {
  const engine = new DisabledTestVariableQuoteEngine({ enabled: true, rate });
  assert.throws(() => engine.quote({ orderId: '00000000-0000-4000-8000-000000000007', destinationRecipient: recipientA, sourceAtomic: '999', now }), /outside/);
  assert.throws(() => engine.quote({ orderId: '00000000-0000-4000-8000-000000000008', destinationRecipient: recipientA, sourceAtomic: '1.5', now }), /base-10 integer/);
  assert.throws(() => engine.quote({ orderId: '00000000-0000-4000-8000-000000000009', destinationRecipient: recipientA, sourceAtomic: '1000', now: Date.parse(rate.expiresAt) }), /expired/);
  assert.throws(() => engine.quote({ orderId: '00000000-0000-4000-8000-000000000010', destinationRecipient: recipientA, sourceAtomic: '1000', now: Date.parse(rate.approvedAt) - 1 }), /not active yet/);
});
