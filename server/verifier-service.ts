import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { checkBaseSepoliaRpcHealth, verifyBaseSepoliaTransaction, type BaseVerificationRequest } from './base-sepolia-verifier.ts';

function json(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.statusCode = status; response.setHeader('content-type', 'application/json; charset=utf-8'); response.setHeader('cache-control', 'no-store'); response.setHeader('x-content-type-options', 'nosniff'); response.end(JSON.stringify(value));
}

async function token(): Promise<string> {
  const path = process.env.VERIFIER_TOKEN_FILE;
  if (!path) throw new Error('VERIFIER_TOKEN_FILE is required');
  const value = (await readFile(path, 'utf8')).trim();
  if (value.length < 32 || value.includes('\n')) throw new Error('Verifier token is invalid');
  return value;
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b);
}

async function body(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''; let size = 0;
  for await (const chunk of request) { const value = Buffer.from(chunk); size += value.length; if (size > 8_192) throw new Error('Request body is too large'); raw += value.toString('utf8'); }
  const parsed = JSON.parse(raw || '{}') as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('JSON object required');
  return parsed as Record<string, unknown>;
}

export function createVerifierServer(expectedToken: string) {
  return createServer({ maxHeaderSize: 8_192, requestTimeout: 10_000, headersTimeout: 7_000 }, async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://internal').pathname;
    if (request.method === 'GET' && path === '/health/live') return json(response, 200, { status: 'live' });
    if (request.method === 'GET' && path === '/health/ready') {
      try { await checkBaseSepoliaRpcHealth(); return json(response, 200, { status: 'ready' }); }
      catch { return json(response, 503, { status: 'not-ready' }); }
    }
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ') || !equal(authorization.slice(7), expectedToken)) return json(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Verifier authorization required.' } });
    if (request.method === 'POST' && path === '/v1/base/verify') {
      try {
        const value = await body(request);
        const input = value as Partial<BaseVerificationRequest>;
        if (typeof input.orderId !== 'string' || typeof input.transactionId !== 'string' || typeof input.recipient !== 'string' || typeof input.amountAtomic !== 'string' || typeof input.expectedSender !== 'string') throw new Error('Exact order, transaction, recipient, amount, and operator-confirmed payout sender are required');
        const evidence = await verifyBaseSepoliaTransaction(input as BaseVerificationRequest);
        return json(response, 200, { evidence });
      } catch (error) { return json(response, 400, { error: { code: 'VERIFICATION_REJECTED', message: error instanceof Error ? error.message : 'Verification rejected' } }); }
    }
    return json(response, 404, { error: { code: 'NOT_FOUND', message: 'Verifier route not found.' } });
  });
}

async function start(): Promise<void> {
  const server = createVerifierServer(await token());
  const host = process.env.HOST ?? '127.0.0.1'; const port = Number(process.env.PORT ?? '8790');
  server.listen(port, host, () => process.stdout.write(`${JSON.stringify({ level: 'info', event: 'verifier_started', host, port })}\n`));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) void start().catch(error => {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'verifier_start_failed', message: error instanceof Error ? error.message : 'unknown' })}\n`); process.exitCode = 1;
});
