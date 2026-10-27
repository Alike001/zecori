import test from 'node:test';
import assert from 'node:assert/strict';
import { EXECUTABLE_ROUTE_ID, ROUTE_CAPABILITIES, evaluateRouteReadiness, routeCapabilitiesForReadiness } from './route-capabilities.ts';

const now = Date.parse('2030-01-01T00:00:00.000Z');

test('route enablement requires operator, liquidity and current fixed terms', () => {
  const ready = evaluateRouteReadiness({ operatorAttested: true, liquidityReady: true, termsValidUntil: '2030-01-01T00:10:00.000Z', now });
  assert.equal(ready.enabled, true);
  assert.deepEqual({ operator: ready.operator, liquidity: ready.liquidity, terms: ready.terms }, { operator: 'attested', liquidity: 'ready', terms: 'current' });
  const route = routeCapabilitiesForReadiness(ready).find(item => item.id === EXECUTABLE_ROUTE_ID)!;
  assert.equal(route.availability, 'verified-executable');
  assert.equal(route.execution.enabled, true);
  assert.equal(route.destination.chainId, 84532);
  assert.match(route.destination.contract ?? '', /^0x[0-9A-Fa-f]{40}$/);
});

test('missing liquidity and stale or unconfigured terms fail closed independently', () => {
  const missingLiquidity = evaluateRouteReadiness({ operatorAttested: true, liquidityReady: false, termsValidUntil: '2030-01-01T00:10:00.000Z', now });
  assert.equal(missingLiquidity.enabled, false); assert.equal(missingLiquidity.liquidity, 'missing'); assert.match(missingLiquidity.reason, /liquidity/i);
  const stale = evaluateRouteReadiness({ operatorAttested: true, liquidityReady: true, termsValidUntil: '2029-12-31T23:59:59.000Z', now });
  assert.equal(stale.enabled, false); assert.equal(stale.terms, 'stale'); assert.match(stale.reason, /expired/i);
  const unconfigured = evaluateRouteReadiness({ operatorAttested: true, liquidityReady: true, now });
  assert.equal(unconfigured.enabled, false); assert.equal(unconfigured.terms, 'unconfigured');
  for (const state of [missingLiquidity, stale, unconfigured]) {
    const route = routeCapabilitiesForReadiness(state).find(item => item.id === EXECUTABLE_ROUTE_ID)!;
    assert.equal(route.availability, 'operator-review-required'); assert.equal(route.execution.enabled, false);
  }
});

test('static registry advertises no unavailable route as usable', () => {
  assert.equal(ROUTE_CAPABILITIES.filter(route => route.execution.enabled).length, 0);
  const guarded = ROUTE_CAPABILITIES.find(route => route.id === EXECUTABLE_ROUTE_ID)!;
  assert.equal(guarded.availability, 'operator-review-required');
  assert.equal(guarded.execution.amount, '0.01 TAZ');
  assert.equal(guarded.execution.outcome, '1 test USDC');
  for (const route of ROUTE_CAPABILITIES.filter(route => route.id !== EXECUTABLE_ROUTE_ID)) {
    assert.ok(['experimental-disabled', 'research-only'].includes(route.availability));
    assert.equal(route.execution.enabled, false);
    assert.equal('provider' in route.execution, false);
  }
});
