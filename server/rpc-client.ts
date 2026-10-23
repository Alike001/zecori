export type RpcCall = <T>(method: string, params?: unknown[]) => Promise<T>;

type RpcEnvelope<T> = { result?: T; error?: { code?: number; message?: string } | null };

export type ExactJsonInteger = { readonly __exactJsonInteger: string };

export function exactJsonInteger(value: string): ExactJsonInteger {
  if (!/^\d+$/.test(value)) throw new Error('Exact JSON integer must be unsigned decimal');
  return Object.freeze({ __exactJsonInteger: BigInt(value).toString() });
}

function serializeJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('RPC numeric parameters must be safe integers; use exactJsonInteger for larger values');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(serializeJson).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (Object.keys(object).length === 1 && typeof object.__exactJsonInteger === 'string') return exactJsonInteger(object.__exactJsonInteger).__exactJsonInteger;
    return `{${Object.entries(object).filter(([, item]) => item !== undefined).map(([key, item]) => `${JSON.stringify(key)}:${serializeJson(item)}`).join(',')}}`;
  }
  throw new Error('Unsupported JSON-RPC parameter type');
}

export function parseJsonPreservingIntegers(text: string): unknown {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') { inString = true; output += char; index += 1; continue; }
    if (char === '-' || /\d/.test(char)) {
      const match = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!match) throw new Error('Invalid JSON number');
      const token = match[0];
      if (/^-?\d+$/.test(token) && (BigInt(token) > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(token) < BigInt(Number.MIN_SAFE_INTEGER))) output += JSON.stringify(token);
      else output += token;
      index += token.length;
      continue;
    }
    output += char; index += 1;
  }
  return JSON.parse(output) as unknown;
}

export function jsonRpcClient(
  endpoint: string,
  options: { authorization?: string; timeoutMs?: number; version?: '1.0' | '2.0' } = {},
): RpcCall {
  const timeoutMs = options.timeoutMs ?? 8_000;
  return async <T>(method: string, params: unknown[] = []): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(options.authorization ? { authorization: options.authorization } : {}),
        },
        body: serializeJson({ jsonrpc: options.version ?? '2.0', id: 1, method, params }),
      });
      if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
      const envelope = parseJsonPreservingIntegers(await response.text()) as RpcEnvelope<T>;
      if (envelope.error) throw new Error(`RPC ${envelope.error.code ?? 'error'}: ${envelope.error.message ?? 'request failed'}`);
      if (!('result' in envelope)) throw new Error('RPC response has no result');
      return envelope.result as T;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('RPC request timed out');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}
