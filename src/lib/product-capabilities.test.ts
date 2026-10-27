import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_STATUSES, PRODUCT_CAPABILITIES, productCapability } from './product-capabilities.ts';

test('product capabilities use explicit truth statuses and unique identifiers', () => {
  assert.equal(new Set(PRODUCT_CAPABILITIES.map(item => item.id)).size, PRODUCT_CAPABILITIES.length);
  assert.ok(PRODUCT_CAPABILITIES.every(item => FEATURE_STATUSES.includes(item.status)));
  assert.equal(productCapability('privy-auth').status, 'DISABLED');
  assert.equal(productCapability('handles').status, 'EXPERIMENTAL');
  assert.equal(productCapability('inbox').status, 'EXPERIMENTAL');
  assert.equal(productCapability('live-quotes').status, 'DISABLED');
});

test('no planned or disabled capability makes a live feature claim', () => {
  for (const item of PRODUCT_CAPABILITIES.filter(entry => entry.status === 'PLANNED' || entry.status === 'DISABLED')) {
    assert.doesNotMatch(`${item.summary} ${item.evidence}`, /\b(?:active now|available now|shipped)\b/i);
  }
});
