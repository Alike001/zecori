import test from 'node:test';
import assert from 'node:assert/strict';
import { EXECUTABLE_ROUTE_ID, ROUTE_CAPABILITIES, routeCapabilitiesForRequestState } from './route-capabilities.ts';

test('route registry fails closed until runtime operator readiness is attested', () => {
  const executable = ROUTE_CAPABILITIES.filter(route => route.execution.enabled);
  assert.equal(executable.length, 0);
  const guarded = ROUTE_CAPABILITIES.find(route => route.id === EXECUTABLE_ROUTE_ID)!;
  assert.equal(guarded.availability, 'operator-review-required');
  assert.equal(guarded.execution.amount, '0.01 TAZ');
  assert.equal(guarded.execution.outcome, '1 test USDC');
  const attested = routeCapabilitiesForRequestState(true).find(route => route.id === EXECUTABLE_ROUTE_ID)!;
  assert.equal(attested.availability, 'verified-executable');
  assert.equal(attested.execution.enabled, true);
  for (const route of ROUTE_CAPABILITIES.filter(route => !route.execution.enabled)) {
    assert.ok(['operator-review-required', 'experimental-disabled', 'research-only'].includes(route.availability));
    if (route.id !== EXECUTABLE_ROUTE_ID) {
      assert.equal('amount' in route.execution, false);
      assert.equal('outcome' in route.execution, false);
      assert.equal('provider' in route.execution, false);
    }
  }
});
