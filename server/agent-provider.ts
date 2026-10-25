import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { AgentToolDefinition } from './agent-tools.ts';

export type AgentModelInput =
  | { type: 'user'; text: string }
  | { type: 'provider_item'; value: Record<string, unknown> }
  | { type: 'tool_output'; callId: string; name: string; output: string };

export type AgentModelToolCall = { callId: string; name: string; arguments: unknown };
export type AgentModelTurn = {
  responseId: string;
  providerRequestId?: string;
  text?: string;
  toolCalls: AgentModelToolCall[];
  replay: AgentModelInput[];
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
};
export type AgentModelRequest = {
  instructions: string;
  input: AgentModelInput[];
  tools: AgentToolDefinition[];
};

export interface AgentModelProvider {
  readonly id: string;
  createTurn(request: AgentModelRequest): Promise<AgentModelTurn>;
}

type OpenAIResponseItem = {
  type?: unknown; call_id?: unknown; name?: unknown; arguments?: unknown;
  content?: Array<{ type?: unknown; text?: unknown }>;
};

export class AgentProviderError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly providerRequestId?: string;
  constructor(
    message: string,
    status: number,
    retryAfterSeconds?: number,
    providerRequestId?: string,
  ) {
    super(message);
    this.name = 'AgentProviderError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.providerRequestId = providerRequestId;
  }
}

type ResponsesProviderOptions = {
  id: 'openai-responses' | 'groq-responses';
  includeStoreFalse: boolean;
};

class ResponsesProvider implements AgentModelProvider {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly maxOutputTokens: number;
  private readonly includeStoreFalse: boolean;
  constructor(
    options: ResponsesProviderOptions,
    apiKey: string,
    model: string,
    baseUrl = 'https://api.openai.com/v1',
    fetcher: typeof fetch = fetch,
    maxOutputTokens = 600,
  ) {
    this.id = options.id;
    this.includeStoreFalse = options.includeStoreFalse;
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
    this.maxOutputTokens = maxOutputTokens;
  }

  async createTurn(request: AgentModelRequest): Promise<AgentModelTurn> {
    const input = request.input.map(item => {
      if (item.type === 'user') return { role: 'user', content: [{ type: 'input_text', text: item.text }] };
      if (item.type === 'provider_item') return item.value;
      return { type: 'function_call_output', call_id: item.callId, output: item.output };
    });
    if (JSON.stringify(input).length > 32_000) throw new Error('Model request exceeds the configured input boundary.');
    const body: Record<string, unknown> = {
      model: this.model,
      instructions: request.instructions,
      input,
      tools: request.tools,
      tool_choice: request.input.some(item => item.type === 'tool_output') ? 'auto' : 'required',
      parallel_tool_calls: false,
      max_output_tokens: this.maxOutputTokens,
    };
    if (this.includeStoreFalse) body.store = false;
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const retryAfter = response.status === 429 ? Number(response.headers.get('retry-after')) : undefined;
      throw new AgentProviderError(
        `Model provider returned HTTP ${response.status}.`,
        response.status,
        Number.isFinite(retryAfter) && retryAfter! >= 0 ? retryAfter : undefined,
        response.headers.get('x-request-id') ?? undefined,
      );
    }
    const rawBody = await response.text();
    if (rawBody.length > 262_144) throw new Error('Model provider response exceeds the configured boundary.');
    let value: { id?: unknown; status?: unknown; output?: unknown; output_text?: unknown; usage?: unknown };
    try { value = JSON.parse(rawBody) as typeof value; } catch { throw new Error('Model provider returned malformed JSON.'); }
    if (typeof value.id !== 'string' || value.status !== 'completed' || !Array.isArray(value.output)) throw new Error('Model provider returned an invalid or incomplete response.');
    const toolCalls: AgentModelToolCall[] = [];
    const textParts: string[] = [];
    for (const raw of value.output) {
      if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('Model provider returned an invalid output item.');
      const item = raw as OpenAIResponseItem;
      if (item.type === 'function_call') {
        if (typeof item.call_id !== 'string' || typeof item.name !== 'string' || typeof item.arguments !== 'string') throw new Error('Model provider returned an invalid tool call.');
        let parsed: unknown;
        try { parsed = JSON.parse(item.arguments); } catch { throw new Error('Model provider returned malformed tool arguments.'); }
        toolCalls.push({ callId: item.call_id, name: item.name, arguments: parsed });
      }
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const content of item.content) if (content.type === 'output_text' && typeof content.text === 'string') textParts.push(content.text);
      }
    }
    const outputText = typeof value.output_text === 'string' ? value.output_text : textParts.join('\n');
    if (!toolCalls.length && !outputText.trim()) throw new Error('Model provider returned no usable output.');
    const usage = value.usage as { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown } | undefined;
    const validUsage = usage && [usage.input_tokens, usage.output_tokens, usage.total_tokens].every(item => Number.isSafeInteger(item) && Number(item) >= 0)
      ? { inputTokens: Number(usage.input_tokens), outputTokens: Number(usage.output_tokens), totalTokens: Number(usage.total_tokens) }
      : undefined;
    return {
      responseId: value.id,
      ...(response.headers.get('x-request-id') ? { providerRequestId: response.headers.get('x-request-id')! } : {}),
      ...(outputText.trim() ? { text: outputText.trim() } : {}),
      toolCalls,
      replay: (value.output as Array<Record<string, unknown>>).map(item => ({ type: 'provider_item', value: item })),
      ...(validUsage ? { usage: validUsage } : {}),
    };
  }
}

export class OpenAIResponsesProvider extends ResponsesProvider {
  constructor(apiKey: string, model: string, baseUrl = 'https://api.openai.com/v1', fetcher: typeof fetch = fetch, maxOutputTokens = 600) {
    super({ id: 'openai-responses', includeStoreFalse: true }, apiKey, model, baseUrl, fetcher, maxOutputTokens);
  }
}

export class GroqResponsesProvider extends ResponsesProvider {
  constructor(apiKey: string, model = 'openai/gpt-oss-20b', baseUrl = 'https://api.groq.com/openai/v1', fetcher: typeof fetch = fetch, maxOutputTokens = 600) {
    super({ id: 'groq-responses', includeStoreFalse: false }, apiKey, model, baseUrl, fetcher, maxOutputTokens);
  }
}

export type AgentProviderConfiguration = {
  provider?: AgentModelProvider;
  maxProviderCalls: number;
  status: { mode: 'model-backed' | 'limited'; provider?: string; model?: string; reason?: string; externalRequestsApproved: boolean; limits: { maxOutputTokens: number; maxProviderCalls: number }; dataHandling?: { responseStorageControl: 'request-disabled' | 'provider-default'; retentionNotice: string } };
};

async function privateCredential(path: string, production: boolean): Promise<string> {
  if (!isAbsolute(path)) throw new Error('AI_API_KEY_FILE must be an absolute path.');
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('AI_API_KEY_FILE must be a regular, non-symlink file.');
  if ((metadata.mode & 0o077) !== 0) throw new Error('AI_API_KEY_FILE must not be accessible by group or other users.');
  const key = (await readFile(path, 'utf8')).trim();
  if (key.length < 20 || key.includes('\n')) throw new Error('AI_API_KEY_FILE must contain one credential.');
  if (production && metadata.uid !== process.getuid?.()) throw new Error('AI_API_KEY_FILE must be owned by the runtime user in production.');
  return key;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  return parsed;
}

export async function loadAgentProvider(environment: NodeJS.ProcessEnv = process.env): Promise<AgentProviderConfiguration> {
  const providerName = environment.AI_PROVIDER?.trim();
  const model = environment.AI_MODEL?.trim();
  const file = environment.AI_API_KEY_FILE?.trim();
  const maxOutputTokens = boundedInteger(environment.AI_MAX_OUTPUT_TOKENS, 600, 128, 2_048, 'AI_MAX_OUTPUT_TOKENS');
  const maxProviderCalls = boundedInteger(environment.AI_MAX_PROVIDER_CALLS, 3, 1, 4, 'AI_MAX_PROVIDER_CALLS');
  const limits = { maxOutputTokens, maxProviderCalls };
  const approved = environment.AI_EXTERNAL_REQUESTS_APPROVED === 'I_APPROVE_CHARGEABLE_MODEL_REQUESTS';
  if (!providerName && !model && !file) return { maxProviderCalls, status: { mode: 'limited', reason: 'No model provider credentials are configured.', externalRequestsApproved: false, limits } };
  if (!approved) return { maxProviderCalls, status: { mode: 'limited', reason: 'Model configuration is present, but chargeable external requests have not been explicitly approved.', externalRequestsApproved: false, limits } };
  if (providerName !== 'openai-responses' && providerName !== 'groq-responses') throw new Error('AI_PROVIDER must be openai-responses or groq-responses when model credentials are configured.');
  if (!model) throw new Error('AI_MODEL is required when AI_PROVIDER is configured.');
  if (providerName === 'groq-responses' && model !== 'openai/gpt-oss-20b') throw new Error('AI_MODEL must be openai/gpt-oss-20b for the initial Groq adapter.');
  if (!file) throw new Error('AI_API_KEY_FILE is required when external model requests are approved.');
  const apiKey = await privateCredential(file, environment.NODE_ENV === 'production');
  const baseUrl = environment.AI_BASE_URL?.trim() || (providerName === 'groq-responses' ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1');
  const parsed = new URL(baseUrl);
  const expectedOrigin = providerName === 'groq-responses' ? 'https://api.groq.com' : 'https://api.openai.com';
  const expectedPath = providerName === 'groq-responses' ? '/openai/v1' : '/v1';
  const official = parsed.origin === expectedOrigin && parsed.pathname.replace(/\/$/, '') === expectedPath && !parsed.search && !parsed.hash;
  const localDevelopment = environment.NODE_ENV !== 'production' && parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (!official && !localDevelopment) throw new Error(`AI_BASE_URL must be the official ${providerName === 'groq-responses' ? 'Groq OpenAI-compatible' : 'OpenAI'} v1 endpoint (or loopback HTTP in development).`);
  const provider = providerName === 'groq-responses'
    ? new GroqResponsesProvider(apiKey, model, baseUrl, fetch, maxOutputTokens)
    : new OpenAIResponsesProvider(apiKey, model, baseUrl, fetch, maxOutputTokens);
  const dataHandling = providerName === 'groq-responses'
    ? { responseStorageControl: 'provider-default' as const, retentionNotice: 'Groq does not support the Responses store parameter. Provider data controls and temporary abuse/reliability logging may apply.' }
    : { responseStorageControl: 'request-disabled' as const, retentionNotice: 'Response object storage is disabled for this request; provider safety and abuse-monitoring retention may still apply.' };
  return { provider, maxProviderCalls, status: { mode: 'model-backed', provider: providerName, model, externalRequestsApproved: true, limits, dataHandling } };
}
