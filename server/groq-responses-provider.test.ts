import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentProviderError, GroqResponsesProvider, loadAgentProvider, type AgentModelRequest } from './agent-provider.ts';

const userPrompt = 'Retrieve the public supported route.';
const request: AgentModelRequest = {
  instructions: 'Use only registered tools.',
  input: [{ type: 'user', text: userPrompt }],
  tools: [{
    type: 'function' as const,
    name: 'get_supported_routes',
    description: 'Returns registered public routes.',
    strict: true,
    parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] },
  }],
};

test('Groq adapter uses the official Responses endpoint and omits unsupported parameters', async () => {
  let url = '';
  let body: Record<string, unknown> = {};
  const provider = new GroqResponsesProvider('synthetic-key', 'openai/gpt-oss-20b', undefined, async (input, init) => {
    url = String(input);
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: 'resp_groq_public_route', object: 'response', status: 'completed',
      output: [
        { id: 'rs_1', type: 'reasoning', summary: [] },
        { id: 'fc_1', type: 'function_call', call_id: 'call_route_1', name: 'get_supported_routes', arguments: '{}' },
      ],
      usage: { input_tokens: 41, output_tokens: 17, total_tokens: 58 },
    }), { status: 200, headers: { 'x-request-id': 'groq-request-1', 'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-requests': '999', 'x-ratelimit-limit-tokens': '8000' } });
  }, 256);

  const turn = await provider.createTurn(request);
  assert.equal(url, 'https://api.groq.com/openai/v1/responses');
  assert.equal(body.model, 'openai/gpt-oss-20b');
  assert.equal(body.max_output_tokens, 256);
  assert.equal(body.parallel_tool_calls, false);
  for (const unsupported of ['store', 'previous_response_id', 'truncation', 'include', 'safety_identifier', 'prompt_cache_key', 'prompt']) {
    assert.equal(unsupported in body, false, `${unsupported} must not be sent to Groq`);
  }
  assert.deepEqual(turn.toolCalls, [{ callId: 'call_route_1', name: 'get_supported_routes', arguments: {} }]);
  assert.equal(turn.replay.length, 2);
  assert.equal(turn.providerRequestId, 'groq-request-1');
  assert.deepEqual(turn.usage, { inputTokens: 41, outputTokens: 17, totalTokens: 58 });
  assert.deepEqual(turn.rateLimits, { limitRequests: '1000', remainingRequests: '999', limitTokens: '8000' });
});

test('Groq model inventory returns only validated model IDs', async () => {
  const provider = new GroqResponsesProvider('synthetic-key', undefined, undefined, async input => {
    assert.equal(String(input), 'https://api.groq.com/openai/v1/models');
    return new Response(JSON.stringify({ data: [{ id: 'whisper-large-v3-turbo' }, { id: 'openai/gpt-oss-20b' }] }), { status: 200 });
  });
  assert.deepEqual(await provider.listAvailableModels(), ['openai/gpt-oss-20b', 'whisper-large-v3-turbo']);
});

test('Groq continuation replays response items and submits function output without response IDs', async () => {
  let body: Record<string, unknown> = {};
  const provider = new GroqResponsesProvider('synthetic-key', undefined, 'http://127.0.0.1:9999', async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: 'resp_final', status: 'completed',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The registered route uses fixed test terms.' }] }],
    }), { status: 200 });
  });
  const toolItem = { type: 'function_call', call_id: 'call_route_1', name: 'get_supported_routes', arguments: '{}' };
  const turn = await provider.createTurn({ ...request, input: [
    request.input[0],
    { type: 'provider_item', value: toolItem },
    { type: 'tool_output', callId: 'call_route_1', name: 'get_supported_routes', output: '{"data":{"routes":[]}}' },
  ] });
  assert.equal(body.tool_choice, 'auto');
  assert.deepEqual(body.input, [
    { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
    toolItem,
    { type: 'function_call_output', call_id: 'call_route_1', output: '{"data":{"routes":[]}}' },
  ]);
  assert.equal('previous_response_id' in body, false);
  assert.equal(turn.text, 'The registered route uses fixed test terms.');
});

test('Groq adapter rejects malformed response and tool-call formats', async () => {
  const malformedJson = new GroqResponsesProvider('synthetic-key', undefined, undefined, async () => new Response('{not-json', { status: 200 }));
  await assert.rejects(malformedJson.createTurn(request), /malformed JSON/i);

  const malformedCall = new GroqResponsesProvider('synthetic-key', undefined, undefined, async () => new Response(JSON.stringify({
    id: 'resp_bad', status: 'completed', output: [{ type: 'function_call', call_id: 'call_bad', name: 'get_supported_routes', arguments: '{bad' }],
  }), { status: 200 }));
  await assert.rejects(malformedCall.createTurn(request), /malformed tool arguments/i);

  const unusable = new GroqResponsesProvider('synthetic-key', undefined, undefined, async () => new Response(JSON.stringify({
    id: 'resp_empty', status: 'completed', output: [],
  }), { status: 200 }));
  await assert.rejects(unusable.createTurn(request), /no usable output/i);
});

test('Groq rate limits and provider failures expose bounded metadata without provider payloads', async () => {
  const secretPayload = 'private-value-that-must-not-escape';
  const rateLimited = new GroqResponsesProvider('synthetic-key', undefined, undefined, async () => new Response(JSON.stringify({
    error: { message: secretPayload, type: 'rate_limit_error' },
  }), { status: 429, headers: { 'retry-after': '7', 'x-request-id': 'groq-rate-1' } }));
  await assert.rejects(rateLimited.createTurn(request), error => {
    assert.ok(error instanceof AgentProviderError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, 7);
    assert.equal(error.providerRequestId, 'groq-rate-1');
    assert.doesNotMatch(error.message, new RegExp(secretPayload));
    return true;
  });

  const invalidTool = new GroqResponsesProvider('synthetic-key', undefined, undefined, async () => new Response(JSON.stringify({
    error: { message: 'Invalid tool call generated', failed_generation: { attempted_arguments: secretPayload } },
  }), { status: 400 }));
  await assert.rejects(invalidTool.createTurn(request), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'Model provider returned HTTP 400.');
    assert.doesNotMatch(error.message, new RegExp(secretPayload));
    return true;
  });
});

test('Groq configuration requires exact provider, model, key-file controls, and external approval', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-groq-config-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const keyFile = join(folder, 'groq-key');
  await writeFile(keyFile, 'synthetic-groq-key-value-for-tests');
  await chmod(keyFile, 0o600);
  const base = { AI_PROVIDER: 'groq-responses', AI_MODEL: 'openai/gpt-oss-20b', AI_API_KEY_FILE: keyFile };

  const inert = await loadAgentProvider(base);
  assert.equal(inert.provider, undefined);
  assert.equal(inert.status.externalRequestsApproved, false);

  const approved = await loadAgentProvider({ ...base, AI_EXTERNAL_REQUESTS_APPROVED: 'I_APPROVE_CHARGEABLE_MODEL_REQUESTS' });
  assert.equal(approved.provider?.id, 'groq-responses');
  assert.equal(approved.status.dataHandling?.responseStorageControl, 'provider-default');
  assert.match(approved.status.dataHandling?.retentionNotice ?? '', /does not support.*store/i);

  await assert.rejects(loadAgentProvider({ ...base, AI_MODEL: 'another-model', AI_EXTERNAL_REQUESTS_APPROVED: 'I_APPROVE_CHARGEABLE_MODEL_REQUESTS' }), /openai\/gpt-oss-20b/);
  await assert.rejects(loadAgentProvider({ ...base, AI_BASE_URL: 'https://example.com/openai/v1', AI_EXTERNAL_REQUESTS_APPROVED: 'I_APPROVE_CHARGEABLE_MODEL_REQUESTS' }), /official Groq/i);
});
