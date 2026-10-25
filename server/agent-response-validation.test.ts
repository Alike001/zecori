import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { diagnoseFinancialNarrative, extractStatedRouteIds, normalizeFinancialText, validateFinancialNarrative } from './agent-response-validation.ts';

test('regression: sanitized Groq Markdown table extracts the data cell, never the Kind heading', async () => {
  const fixture = await readFile(new URL('./fixtures/groq-route-markdown.sanitized.txt', import.meta.url), 'utf8');
  const diagnostic = diagnoseFinancialNarrative(fixture);
  assert.equal(diagnostic.valid, true);
  assert.equal(diagnostic.facts.routeId, 'zcash-testnet-to-base-sepolia-fixed');
  assert.deepEqual(diagnostic.facts.routeIds, ['zcash-testnet-to-base-sepolia-fixed']);
  assert.notEqual(diagnostic.facts.routeId, 'kind');
});

test('extracts only explicit route values across prose, bold Markdown, and Unicode separators', () => {
  for (const text of [
    'Route ID: zcash-testnet-to-base-sepolia-fixed',
    'The route ID is zcash-testnet-to-base-sepolia-fixed.',
    '**Route ID:** **zcash-testnet-to-base-sepolia-fixed**',
    'Route ID — zcash-testnet-to-base-sepolia-fixed',
    'Route ID：zcash-testnet-to-base-sepolia-fixed',
    'Identifiant de route : zcash-testnet-to-base-sepolia-fixed',
    'معرف المسار: zcash-testnet-to-base-sepolia-fixed',
  ]) assert.deepEqual(extractStatedRouteIds(text), ['zcash-testnet-to-base-sepolia-fixed'], text);
  assert.deepEqual(extractStatedRouteIds('| Route ID | Kind | Source | Destination |'), []);
});

test('accepts omission but rejects wrong route IDs in prose and Markdown data cells', () => {
  assert.equal(diagnoseFinancialNarrative('The verified route details are shown below.').facts.routeId, undefined);
  assert.equal(validateFinancialNarrative('The verified route details are shown below.').valid, true);
  for (const text of [
    'Route ID: invented-testnet-route',
    '| Route ID | Kind |\n| --- | --- |\n| invented-testnet-route | fixed-test-terms |',
  ]) assert.equal(diagnoseFinancialNarrative(text).failedRule, 'incorrect-route-id', text);
});

test('rejects invented providers in labeled Markdown data cells without reading the Provider heading as a value', () => {
  const correct = '| Route ID | Provider |\n| --- | --- |\n| zcash-testnet-to-base-sepolia-fixed | zecathon-testnet-lp-01 |';
  assert.equal(diagnoseFinancialNarrative(correct).valid, true);
  assert.deepEqual(diagnoseFinancialNarrative(correct).facts.providerIds, ['zecathon-testnet-lp-01']);
  assert.equal(diagnoseFinancialNarrative('| Route ID | Provider |').facts.providerIds.length, 0);
  assert.equal(diagnoseFinancialNarrative('| Route ID | Provider |\n| --- | --- |\n| zcash-testnet-to-base-sepolia-fixed | Acme |').failedRule, 'unregistered-provider-claim');
  assert.equal(diagnoseFinancialNarrative('Provider: Acme').failedRule, 'unregistered-provider-claim');
});

test('accepts exact route facts in Markdown tables without treating formatting as financial data', () => {
  const result = validateFinancialNarrative(`
| Field | Amount | Asset |
| --- | ---: | --- |
| Source | **0.01** | **TAZ** |
| Destination | **1** | test-USDC |

Destination chain: **Base Sepolia**
Classification: fixed test terms; this is not a live market quote.
The assistant cannot create or authorize an order.
`, true);
  assert.equal(result.valid, true);
});

test('normalizes Unicode spacing and multiline exact route output', () => {
  const text = 'Source:\n0.01\u202fTAZ\nDestination:\n1\u00a0test USDC\nBase\u2009Sepolia\nNo live market quote; test-only. No action was taken.';
  const result = validateFinancialNarrative(text, true);
  assert.equal(result.valid, true);
  assert.match(normalizeFinancialText(text), /0\.01 TAZ/);
});

test('rejects wrong financial amounts rather than relaxing presentation checks', () => {
  assert.deepEqual(validateFinancialNarrative('Fixed test terms: 0.02 TAZ to 1 test USDC on Base Sepolia.', true), {
    valid: false,
    normalized: 'Fixed test terms: 0.02 TAZ to 1 test USDC on Base Sepolia.',
    reason: 'incorrect-taz-amount',
  });
  assert.equal(validateFinancialNarrative('Fixed test terms: 0.01 TAZ to 2 test USDC on Base Sepolia.', true).valid, false);
  assert.equal(validateFinancialNarrative('Fixed test terms: $0.02 TAZ to 1 test USDC on Base Sepolia.', true).valid, false);
});

test('rejects hallucinated route IDs, networks, live quotes, and order authority', () => {
  for (const text of [
    'Route ID: zcash-mainnet-to-ethereum-live. Fixed terms are 0.01 TAZ to 1 USDC.',
    'Route ID: invented-testnet-route. It goes from 0.01 TAZ to 1 test USDC on Base Sepolia.',
    'I can retrieve live market quotes for this route.',
    'The assistant can place an order for you.',
  ]) assert.equal(validateFinancialNarrative(text).valid, false, text);
});

test('accepts truthful unavailable-capability language', () => {
  const result = validateFinancialNarrative('I cannot retrieve live quotes or place orders. The registered route has fixed test terms only.');
  assert.equal(result.valid, true);
  assert.equal(validateFinancialNarrative('This testnet route is not available on mainnet and no action was taken.').valid, true);
});

test('distinguishes the exact fixed price from the route transfer amounts', () => {
  const exact = validateFinancialNarrative('Fixed test terms: 0.01 TAZ to 1 test USDC on Base Sepolia. Pricing: 1 TAZ = 100 test USDC. This is not a live market quote. Informational only.', true);
  assert.equal(exact.valid, true);
  assert.equal(validateFinancialNarrative('Fixed test terms: 0.01 TAZ to 1 test USDC on Base Sepolia. Pricing: 1 TAZ = 99 test USDC.', true).valid, false);
  assert.equal(validateFinancialNarrative('Fixed test terms: 0.01 TAZ to 1 test USDC on Base Sepolia. Pricing: 101 test USDC per TAZ.', true).valid, false);
});

test('diagnostics distinguish financial, capability, route, and disclosure failures', () => {
  const cases = [
    ['0.02 TAZ to 1 test USDC on Base Sepolia. Fixed test terms. No action was taken.', false, 'incorrect-taz-amount'],
    ['0.01 TAZ to 2 test USDC on Base Sepolia. Fixed test terms. No action was taken.', false, 'incorrect-usdc-amount'],
    ['0.01 TAZ to 1 test USDC on Base Sepolia. Rate: 1 TAZ = 99 test USDC. Fixed test terms. No action was taken.', false, 'incorrect-fixed-pricing'],
    ['0.01 TAZ to 1 test USDC on Ethereum. Fixed test terms. No action was taken.', false, 'unsupported-network'],
    ['I can retrieve live market quotes. 0.01 TAZ to 1 test USDC on Base Sepolia. No action was taken.', false, 'unavailable-live-quote-claim'],
    ['I can authorize payments. 0.01 TAZ to 1 test USDC on Base Sepolia. Fixed test terms.', false, 'unavailable-order-action-claim'],
    ['0.01 TAZ to 1 test USDC on Base Sepolia. No action was taken.', true, 'missing-test-only-classification'],
    ['0.01 TAZ to 1 test USDC on Base Sepolia. Not a live market quote.', true, 'missing-no-spending-authority'],
  ] as const;
  for (const [text, requireFacts, failedRule] of cases) {
    assert.equal(diagnoseFinancialNarrative(text, requireFacts).failedRule, failedRule, text);
  }
});

test('accepts a valid differently worded public-route explanation', () => {
  const diagnostic = diagnoseFinancialNarrative('The preset test rate sends 0.01 TAZ to 1 test USDC on Base Sepolia. This is informational only, with no real-time pricing.', true);
  assert.equal(diagnostic.valid, true);
});

test('detects Base Sepolia across destination labels, Markdown, punctuation, and Unicode', () => {
  for (const destination of [
    'Base Sepolia',
    'Destination Network: Base Sepolia',
    'Base Sepolia, Chain ID: 84532',
    '**Destination Network:** **Base Sepolia**, **Chain ID:** `84532`',
    'Destination Network: Base\u00a0Sepolia, Chain ID: 84532',
    'Destination Network: Base\u202fSepolia, Chain ID: 84532',
    'Destination Network: Base\u200bSepolia, Chain ID: 84532',
  ]) {
    const text = `0.01 TAZ to 1 test USDC. ${destination}. Fixed test terms, not a live market quote. No orders are created or authorized by this response.`;
    const diagnostic = diagnoseFinancialNarrative(text, true);
    assert.equal(diagnostic.facts.mentionsBaseSepolia, true, `${destination}: ${diagnostic.normalized}`);
    assert.equal(diagnostic.valid, true, `${destination}: ${diagnostic.failedRule}`);
  }
});

test('rejects wrong destination networks and chain IDs', () => {
  assert.equal(diagnoseFinancialNarrative('0.01 TAZ to 1 test USDC. Destination Network: Ethereum. Fixed test terms. No action was taken.', true).failedRule, 'unsupported-network');
  assert.equal(diagnoseFinancialNarrative('0.01 TAZ to 1 test USDC. Destination Network: Base Goerli. Fixed test terms. No action was taken.', true).failedRule, 'unsupported-network');
  assert.equal(diagnoseFinancialNarrative('0.01 TAZ to 1 test USDC. Destination Network: Base Sepolia, Chain ID: 84531. Fixed test terms. No action was taken.', true).failedRule, 'incorrect-destination-chain-id');
});

test('recognizes explicit plural no-authority disclosure without inferring authority from silence', () => {
  const explicit = diagnoseFinancialNarrative('No orders are created or authorized by this response.');
  assert.equal(explicit.facts.statesNoSpendingAuthority, true);
  assert.equal(explicit.valid, true);
  const absent = diagnoseFinancialNarrative('Here are the verified route details.');
  assert.equal(absent.facts.statesNoSpendingAuthority, false);
  assert.equal(absent.valid, true, 'absence is not a positive authority claim');
  assert.equal(diagnoseFinancialNarrative('0.01 TAZ to 1 test USDC on Base Sepolia. Fixed test terms.', true).failedRule, 'missing-no-spending-authority');
});

test('rejects positive spending-authority claims in supported languages but not omitted wording', () => {
  assert.equal(diagnoseFinancialNarrative('Voici les détails vérifiés.').facts.statesNoSpendingAuthority, false);
  assert.equal(diagnoseFinancialNarrative('فيما يلي تفاصيل المسار الموثقة.').facts.statesNoSpendingAuthority, false);
  assert.equal(diagnoseFinancialNarrative('Je peux autoriser un paiement.').failedRule, 'unavailable-order-action-claim');
  assert.equal(diagnoseFinancialNarrative('يمكنني تفويض دفعة.').failedRule, 'unavailable-order-action-claim');
});

test('rejects unsupported completion claims unless backed by an authorized completed-status tool result', () => {
  const claim = 'The transaction completed successfully.';
  assert.equal(diagnoseFinancialNarrative(claim).failedRule, 'unverified-transaction-completion-claim');
  assert.equal(diagnoseFinancialNarrative(claim, false, true).valid, true);
});
