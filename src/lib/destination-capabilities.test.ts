import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_USDC } from './order-coordinator.ts';
import { BASE_SEPOLIA_USDC_DESTINATION_ID, DESTINATION_CAPABILITIES, supportedDestination, validateDestinationCapability } from './destination-capabilities.ts';

test('only Base Sepolia USDC has a configured verifier and contract identity', () => {
  assert.equal(new Set(DESTINATION_CAPABILITIES.map(item => item.id)).size, DESTINATION_CAPABILITIES.length);
  const supported = DESTINATION_CAPABILITIES.filter(item => item.status === 'supported');
  assert.equal(supported.length, 1);
  assert.equal(supported[0].id, BASE_SEPOLIA_USDC_DESTINATION_ID);
  assert.deepEqual(supported[0].network, { id: 'base-sepolia', name: 'Base Sepolia', environment: 'testnet', chainId: 84532 });
  assert.deepEqual(supported[0].asset.contractIdentity, { kind: 'erc20', address: BASE_USDC });
  assert.deepEqual(supported[0].verifier, { kind: 'base-erc20-transfer', implemented: true, minimumConfirmations: 3 });
  assert.ok(DESTINATION_CAPABILITIES.filter(item => item.status === 'disabled').every(item => !item.verifier.implemented && item.readiness.liquidity === 'unavailable'));
});

test('destination selection rejects unsupported, disabled, chain-mismatched and asset-mismatched requests', () => {
  assert.equal(validateDestinationCapability({ network: 'base-sepolia', chainId: 84532, contract: BASE_USDC }).id, BASE_SEPOLIA_USDC_DESTINATION_ID);
  assert.throws(() => validateDestinationCapability({ network: 'ethereum-sepolia', chainId: 11155111, contract: BASE_USDC }), Object.assign(/not configured/, { code: 'UNSUPPORTED_DESTINATION_NETWORK' }));
  assert.throws(() => validateDestinationCapability({ network: 'base-sepolia', chainId: 8453, contract: BASE_USDC }), Object.assign(/do not match/, { code: 'DESTINATION_CHAIN_MISMATCH' }));
  assert.throws(() => validateDestinationCapability({ network: 'base-mainnet', chainId: 8453, contract: BASE_USDC }), Object.assign(/not available/, { code: 'DESTINATION_DISABLED' }));
  assert.throws(() => validateDestinationCapability({ network: 'base-sepolia', chainId: 84532, contract: `0x${'2'.repeat(40)}` }), Object.assign(/does not match/, { code: 'DESTINATION_ASSET_MISMATCH' }));
  assert.equal(supportedDestination().id, BASE_SEPOLIA_USDC_DESTINATION_ID);
});
