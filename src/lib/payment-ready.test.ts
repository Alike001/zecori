import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicOrderRequest } from './order-api.ts';
import { copyExactReceiver, preparePaymentReadyInstructions, recipientFromClipboard } from './payment-ready.ts';

const receiver = `utest1${'q'.repeat(120)}`;
const recipient = '0x1111111111111111111111111111111111111111';
function fixture(overrides: Partial<PublicOrderRequest> = {}): PublicOrderRequest {
  const expiresAt = '2030-01-01T00:00:00.000Z';
  return {
    id: 'payment-ready-fixture', status: 'PAYMENT_READY', createdAt: '2029-12-31T23:00:00.000Z', expiresAt,
    destinationBinding: { status: 'bound', walletControlVerification: 'verified-eoa' },
    terms: {
      source: { network: 'zcash-testnet', asset: 'TAZ', pool: 'ironwood', amountZatoshis: '1000000', amount: '0.01', confirmations: 10 },
      destination: { network: 'base-sepolia', chainId: 84532, asset: 'USDC', contract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', amountAtomic: '1000000', amount: '1', confirmations: 3 },
      provider: { id: 'reviewed-lp', model: 'trusted-liquidity-provider' }, rate: { description: 'fixed test terms' }, custody: 'temporary', refunds: 'manual review',
    },
    destinationReview: { recipient, network: 'base-sepolia', chainId: 84532, asset: 'USDC', contract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', amountAtomic: '1000000' },
    paymentInstructions: { receiver, expiresAt },
    ...overrides,
  };
}

test('PAYMENT_READY presentation preserves exact receiver in display, copy, and QR payload', async () => {
  const prepared = preparePaymentReadyInstructions(fixture(), Date.parse('2029-12-31T23:30:00.000Z'));
  assert.equal(prepared.receiver, receiver);
  assert.equal(prepared.qrPayload, receiver);
  assert.equal(prepared.qrFormat, 'exact-shielded-receiver-v1');
  assert.equal(prepared.sourceNetwork, 'zcash-testnet');
  assert.equal(prepared.destinationChainId, 84532);
  assert.ok(Object.isFrozen(prepared));
  let copied = '';
  await copyExactReceiver(prepared.receiver, { writeText: async value => { copied = value; } });
  assert.equal(copied, prepared.qrPayload);
});

test('instructions fail closed before allocation, after expiry, after status advance, and on term mutation', () => {
  assert.throws(() => preparePaymentReadyInstructions(fixture({ paymentInstructions: undefined }), 0), /not actionable/);
  assert.throws(() => preparePaymentReadyInstructions(fixture(), Date.parse('2030-01-01T00:00:00.001Z')), /expired/);
  assert.throws(() => preparePaymentReadyInstructions(fixture({ status: 'SOURCE_DETECTED' }), 0), /not actionable/);
  const changed = fixture(); changed.destinationReview = { ...changed.destinationReview!, chainId: 84532, contract: '0x1111111111111111111111111111111111111111' };
  assert.throws(() => preparePaymentReadyInstructions(changed, 0), /does not match/);
});

test('manual-recipient clipboard handling preserves exact visible text and rejects hidden changes', () => {
  assert.equal(recipientFromClipboard(recipient), recipient);
  assert.throws(() => recipientFromClipboard(` ${recipient}`), /exact address/);
  assert.throws(() => recipientFromClipboard(`${recipient}\u200b`), /hidden/);
});
