import test from 'node:test';
import assert from 'node:assert/strict';
import { EXECUTABLE_ROUTE_ID, ROUTE_CAPABILITIES } from './route-capabilities.ts';

test('route registry exposes one executable fixed test route and fails closed for every other capability', () => {
  const executable = ROUTE_CAPABILITIES.filter(route => route.execution.enabled);
  assert.equal(executable.length, 1);
  assert.equal(executable[0].id, EXECUTABLE_ROUTE_ID);
  assert.equal(executable[0].availability, 'verified-executable');
  assert.equal(executable[0].execution.amount, '0.01 TAZ');
  assert.equal(executable[0].execution.outcome, '1 test USDC');
  for (const route of ROUTE_CAPABILITIES.filter(route => !route.execution.enabled)) {
    assert.ok(['experimental-disabled', 'research-only'].includes(route.availability));
    assert.equal('amount' in route.execution, false);
    assert.equal('outcome' in route.execution, false);
    assert.equal('provider' in route.execution, false);
  }
});
