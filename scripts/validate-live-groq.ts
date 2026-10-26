import assert from 'node:assert/strict';
import { createAgentGateway, sanitizePublicRouteDiagnostic } from '../server/agent-gateway.ts';
import { loadAgentProvider } from '../server/agent-provider.ts';
import { GroqResponsesProvider } from '../server/agent-provider.ts';
import { diagnoseFinancialNarrative } from '../server/agent-response-validation.ts';
import { MemoryPublicOrderRequestStore } from '../server/public-order-store.ts';

if (process.env.GROQ_LIVE_VALIDATION_APPROVED !== 'I_APPROVE_ONE_GROQ_LIVE_VALIDATION') {
  throw new Error('Groq live validation requires GROQ_LIVE_VALIDATION_APPROVED=I_APPROVE_ONE_GROQ_LIVE_VALIDATION.');
}

const configuration = await loadAgentProvider();
if (configuration.status.provider !== 'groq-responses' || !configuration.provider || configuration.status.mode !== 'model-backed') {
  throw new Error('The approved provider must be groq-responses.');
}
assert.equal(configuration.status.model, 'openai/gpt-oss-20b');
assert.ok(configuration.provider instanceof GroqResponsesProvider);
const availableModels = await configuration.provider.listAvailableModels();
for (const model of ['openai/gpt-oss-20b', 'whisper-large-v3-turbo', 'canopylabs/orpheus-v1-english', 'canopylabs/orpheus-arabic-saudi']) assert.ok(availableModels.includes(model), `Groq account does not expose required model ${model}`);

const gateway = createAgentGateway(configuration.provider, configuration.status.model, {
  maxProviderCalls: 2,
  maxOutputTokens: configuration.status.limits.maxOutputTokens,
  status: configuration.status,
  publicRouteDiagnostics: true,
});
const store = new MemoryPublicOrderRequestStore();
const reply = await gateway.respond(
  'Retrieve the actual public supported route. Clearly say that its fixed test terms are not a live market quote. Do not create or authorize anything.',
  { store },
  'en',
);

assert.equal(reply.mode, 'model-backed');
assert.equal(reply.providerCalls, 2, 'A grounded function-call round trip must use exactly two provider requests.');
assert.deepEqual(reply.toolsUsed, ['get_supported_routes'], 'Groq must return a structured get_supported_routes call that the server executes.');

assert.equal(reply.factCards?.length, 2, 'The executed route tool must produce deterministic explanation and availability cards.');
const route = reply.factCards?.find(card => card.kind === 'route-explanation');
assert.ok(route, 'The route explanation card is required.');
assert.equal(route.routeId, 'zcash-testnet-to-base-sepolia-fixed');
assert.equal(route.classification, 'fixed-test-terms');
assert.deepEqual(route.source, { network: 'zcash-testnet', asset: 'TAZ', pool: 'ironwood', amountZatoshis: '1000000', amount: '0.01' });
assert.deepEqual(route.destination, { network: 'base-sepolia', chainId: 84532, asset: 'USDC', contract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', amountAtomic: '1000000', amount: '1' });
assert.deepEqual(route.provider, { id: 'zecathon-testnet-lp-01', model: 'trusted-liquidity-provider' });
assert.deepEqual(route.pricing, {
  description: 'Experimental fixed test rate: 1 TAZ = 100 test USDC; this is not a live market quote.',
  sourceAtomicUnits: '100000000',
  destinationAtomicUnits: '100000000',
});
assert.deepEqual(route.disclosures, { testOnly: true, liveMarketQuote: false, spendingAuthority: false, createsOrder: false, authorizesPayment: false });
if (reply.refusal) throw new Error(`Live validation failed after verified deterministic route evidence: ${reply.failureCode ?? 'unclassified-refusal'}: ${reply.text}\nSafe public-route diagnostic: ${JSON.stringify(reply.publicRouteDiagnostic ?? { unavailable: true })}`);
const narrative = diagnoseFinancialNarrative(reply.text, true);
if (!narrative.valid) throw new Error(`Model narrative failed ${narrative.failedRule}: ${JSON.stringify({ extractedFacts: narrative.facts, sanitizedModelResponse: sanitizePublicRouteDiagnostic(narrative.normalized) })}`);

process.stdout.write(`${JSON.stringify({
  status: 'GROQ_LIVE_VALIDATION_VERIFIED',
  provider: configuration.status.provider,
  model: configuration.status.model,
  publicSyntheticPromptOnly: true,
  structuredRouteEvidenceVerified: true,
  toolsUsed: reply.toolsUsed,
  providerCalls: reply.providerCalls,
  usage: reply.usage,
  providerRateLimits: reply.providerRateLimits ?? { unavailable: 'The provider did not return quota headers; check the Groq project Limits page.' },
  requiredModelsAvailable: ['openai/gpt-oss-20b', 'whisper-large-v3-turbo', 'canopylabs/orpheus-v1-english', 'canopylabs/orpheus-arabic-saudi'],
  deterministicFactCard: route,
  response: sanitizePublicRouteDiagnostic(reply.text),
}, null, 2)}\n`);
