import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_USDC } from '../src/lib/order-coordinator.ts';
import { DESTINATION_CONSENT, DESTINATION_CONSENT_VERSION, validateWalletReadinessIntent } from './wallet-intent.ts';

const valid = {
  routeId: 'zcash-testnet-to-base-sepolia-fixed', amountZatoshis: '1000000', termsAccepted: true,
  source: { mode: 'external', network: 'zcash-testnet', pool: 'ironwood' },
  destination: { mode: 'manual', network: 'base-sepolia', chainId: 84532, contract: BASE_USDC, address: `0x${'1'.repeat(40)}` },
  destinationConsent: { version: DESTINATION_CONSENT_VERSION, statement: DESTINATION_CONSENT, confirmed: true },
};

test('accepts only an exact fixed-route wallet-readiness intent', () => {
  assert.equal(validateWalletReadinessIntent(valid).destination.address, `0x${'1'.repeat(40)}`);
  assert.throws(() => validateWalletReadinessIntent({ ...valid, amountZatoshis: '2000000' }), /exact fixed test-route/);
});

test('rejects unsupported wallet networks and non-Ironwood source funds', () => {
  assert.throws(() => validateWalletReadinessIntent({ ...valid, source: { ...valid.source, network: 'zcash-mainnet' } }), Object.assign(/testnet/, {}));
  assert.throws(() => validateWalletReadinessIntent({ ...valid, source: { ...valid.source, pool: 'transparent' } }), /Ironwood/);
  assert.throws(() => validateWalletReadinessIntent({ ...valid, destination: { ...valid.destination, network: 'ethereum-sepolia', chainId: 11155111 } }), Object.assign(/not configured/, { code: 'UNSUPPORTED_DESTINATION_NETWORK' }));
  assert.throws(() => validateWalletReadinessIntent({ ...valid, destination: { ...valid.destination, chainId: 8453 } }), Object.assign(/do not match/, { code: 'DESTINATION_CHAIN_MISMATCH' }));
  assert.throws(() => validateWalletReadinessIntent({ ...valid, destination: { ...valid.destination, network: 'base-mainnet', chainId: 8453 } }), Object.assign(/not available/, { code: 'DESTINATION_DISABLED' }));
});

test('rejects invalid and zero destination recipients', () => {
  assert.throws(() => validateWalletReadinessIntent({ ...valid, destination: { ...valid.destination, address: '0x1234' } }), /complete, non-zero/);
  assert.throws(() => validateWalletReadinessIntent({ ...valid, destination: { ...valid.destination, address: `0x${'0'.repeat(40)}` } }), /complete, non-zero/);
  assert.throws(() => validateWalletReadinessIntent({ ...valid, destination: { ...valid.destination, address: '0x52908400098527886E0F7030069857D2E4169Ee7' } }), /EIP-55/);
  assert.throws(() => validateWalletReadinessIntent({ ...valid, destination: { ...valid.destination, contract: `0x${'2'.repeat(40)}` } }), Object.assign(/does not match/, { code: 'DESTINATION_ASSET_MISMATCH' }));
  assert.throws(() => validateWalletReadinessIntent({ ...valid, destinationConsent: { ...valid.destinationConsent, confirmed: false } }), /Explicit confirmation/);
});
