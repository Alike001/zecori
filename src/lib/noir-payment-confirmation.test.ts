import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicOrderRequest } from './order-api.ts';
import { prepareNoirPaymentConfirmation } from './noir-payment-confirmation.ts';

function request(expiresAt = '2030-01-01T00:00:00.000Z'): PublicOrderRequest {
  return {
    id: 'order-1', status: 'PAYMENT_READY', createdAt: '2029-12-31T23:00:00.000Z', expiresAt,
    destinationBinding: { status: 'bound', walletControlVerification: 'verified-eoa' },
    terms: {
      source: { network: 'zcash-testnet', asset: 'TAZ', pool: 'ironwood', amountZatoshis: '1000000', amount: '0.01', confirmations: 10 },
      destination: { network: 'base-sepolia', chainId: 84532, asset: 'USDC', contract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', amountAtomic: '1000000', amount: '1', confirmations: 3 },
      provider: { id: 'reviewed-lp', model: 'trusted-liquidity-provider' }, rate: { description: 'fixed test terms' }, custody: 'temporary', refunds: 'manual review',
    },
    destinationReview: { recipient: '0x1111111111111111111111111111111111111111', network: 'base-sepolia', chainId: 84532, asset: 'USDC', contract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', amountAtomic: '1000000' },
    paymentInstructions: { receiver: 'utest1-dedicated-shielded-receiver', expiresAt },
  };
}

test('review-only confirmation binds exact immutable terms and cannot send', () => {
  const confirmation = prepareNoirPaymentConfirmation(request(), 'shielded', Date.parse('2029-12-31T23:30:00.000Z'));
  assert.deepEqual(confirmation.futureSendRequest, { to: 'utest1-dedicated-shielded-receiver', amount: '0.01', fundingSource: 'shielded' });
  assert.equal(confirmation.sendingEnabled, false);
  assert.equal(confirmation.immutableTerms.destinationChainId, 84532);
  assert.ok(Object.isFrozen(confirmation));
});

test('transparent funding, stale instructions, and mutable expiry mismatches are rejected', () => {
  assert.throws(() => prepareNoirPaymentConfirmation(request(), 'transparent', 0), /Transparent Zcash funding is forbidden/);
  assert.throws(() => prepareNoirPaymentConfirmation(request('2020-01-01T00:00:00.000Z'), 'shielded', Date.parse('2020-01-01T00:00:00.001Z')), /expired/);
  const mismatch = request(); mismatch.paymentInstructions!.expiresAt = '2030-01-02T00:00:00.000Z';
  assert.throws(() => prepareNoirPaymentConfirmation(mismatch, 'shielded', Date.parse('2029-12-31T23:30:00.000Z')), /immutable order expiry/);
});
