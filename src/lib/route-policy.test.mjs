import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRoute } from './route-policy.ts';

const base = {
  provider: 'Research Provider',
  sourcePool: 'ironwood',
  zcashDepositPool: 'ironwood',
  hasTransparentZcashOutput: false,
  evidenceSource: 'independently-verified',
  settlementVerification: 'independent',
  recovery: 'enforceable',
};

test('rejects transparent Zcash deposit', () => {
  const result = assessRoute({
    ...base,
    zcashDepositPool: 'transparent',
  });
  assert.equal(result.privacyCandidate, false);
});

test('rejects unknown transparent-output status', () => {
  const result = assessRoute({
    ...base,
    hasTransparentZcashOutput: null,
  });
  assert.equal(result.privacyCandidate, false);
});

test('rejects provider-only privacy claims', () => {
  const result = assessRoute({
    ...base,
    evidenceSource: 'provider-claim',
  });
  assert.equal(result.privacyCandidate, false);
});

test('flags cross-pool movement', () => {
  const result = assessRoute({
    ...base,
    zcashDepositPool: 'orchard',
  });
  assert.equal(result.privacyCandidate, false);
});

test('warns when recovery depends on a provider', () => {
  const result = assessRoute({
    ...base,
    recovery: 'provider-dependent',
  });
  assert.ok(result.warnings.length > 0);
});

test('never enables unimplemented execution', () => {
  const result = assessRoute(base);
  assert.equal(result.privacyCandidate, true);
  assert.equal(result.canExecute, false);
});

test('rejects legacy Orchard-to-Orchard route', () => {
  const result = assessRoute({
    ...base,
    sourcePool: 'orchard',
    zcashDepositPool: 'orchard',
  });
  assert.equal(result.privacyCandidate, false);
  assert.equal(result.canExecute, false);
});
