import { createReadStream } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PublicOrderRequestStore } from './public-order-store.ts';
import { PostgresPublicOrderRequestStore } from './public-order-store.ts';
import { createPostgresPool } from './postgres.ts';
import { publicApi } from './public-api.ts';
import { isFullEvmAddress } from '../src/lib/order-coordinator.ts';

export type ApplicationServerOptions = {
  store: PublicOrderRequestStore;
  publicOrigin: string;
  destinationRecipient: string;
  staticDirectory?: string;
  requireProxyHttps?: boolean;
  trustProxy?: boolean;
  rateLimit?: { windowMs: number; maximum: number };
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

class RateLimiter {
  private readonly entries = new Map<string, { count: number; reset: number }>();
  private readonly windowMs: number;
  private readonly maximum: number;
  constructor(windowMs: number, maximum: number) { this.windowMs = windowMs; this.maximum = maximum; }
  accept(key: string, now = Date.now()): { allowed: boolean; remaining: number; reset: number } {
    const current = this.entries.get(key);
    const entry = !current || current.reset <= now ? { count: 0, reset: now + this.windowMs } : current;
    entry.count += 1; this.entries.set(key, entry);
    if (this.entries.size > 10_000) for (const [candidate, value] of this.entries) if (value.reset <= now) this.entries.delete(candidate);
    return { allowed: entry.count <= this.maximum, remaining: Math.max(0, this.maximum - entry.count), reset: entry.reset };
  }
}

function clientKey(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader('content-security-policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'");
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('permissions-policy', 'camera=(), geolocation=(), microphone=()');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status; response.setHeader('content-type', 'application/json; charset=utf-8'); response.setHeader('cache-control', 'no-store'); response.end(JSON.stringify(body));
}

async function serveFile(response: ServerResponse, root: string, requested: string): Promise<boolean> {
  const rootReal = await realpath(root);
  const candidate = resolve(rootReal, `.${requested}`);
  if (candidate !== rootReal && !candidate.startsWith(`${rootReal}${sep}`)) return false;
  let file = candidate;
  try { if (!(await stat(file)).isFile()) return false; } catch { return false; }
  file = await realpath(file);
  if (!file.startsWith(`${rootReal}${sep}`)) return false;
  response.statusCode = 200;
  response.setHeader('content-type', MIME[extname(file)] ?? 'application/octet-stream');
  response.setHeader('cache-control', extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable');
  await new Promise<void>((resolveStream, reject) => createReadStream(file).on('error', reject).on('end', resolveStream).pipe(response));
  return true;
}

export function createApplicationServer(options: ApplicationServerOptions) {
  const staticDirectory = options.staticDirectory ?? join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
  const limiter = new RateLimiter(options.rateLimit?.windowMs ?? 60_000, options.rateLimit?.maximum ?? 60);
  const api = publicApi(options.store, { allowedOrigin: options.publicOrigin, destinationRecipient: options.destinationRecipient, secureCookies: Boolean(options.requireProxyHttps) });
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 }, async (request, response) => {
    securityHeaders(response);
    const url = new URL(request.url ?? '/', 'http://internal');
    if (url.pathname === '/health/live') return json(response, 200, { status: 'live' });
    if (url.pathname === '/health/ready') {
      try { await access(join(staticDirectory, 'index.html')); await options.store.health(); return json(response, 200, { status: 'ready' }); }
      catch { return json(response, 503, { status: 'not-ready' }); }
    }
    const limit = limiter.accept(clientKey(request, Boolean(options.trustProxy)));
    response.setHeader('ratelimit-limit', String(options.rateLimit?.maximum ?? 60));
    response.setHeader('ratelimit-remaining', String(limit.remaining));
    response.setHeader('ratelimit-reset', String(Math.ceil(limit.reset / 1000)));
    if (!limit.allowed) return json(response, 429, { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } });
    if (options.requireProxyHttps && request.headers['x-forwarded-proto'] !== 'https') return json(response, 400, { error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required.' } });
    if (await api(request, response)) return;
    if (!['GET', 'HEAD'].includes(request.method ?? '')) return json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch { return json(response, 400, { error: { code: 'INVALID_PATH', message: 'Invalid path.' } }); }
    if (pathname !== '/' && await serveFile(response, staticDirectory, pathname)) return;
    const index = await readFile(join(staticDirectory, 'index.html'));
    response.statusCode = 200; response.setHeader('content-type', 'text/html; charset=utf-8'); response.setHeader('cache-control', 'no-cache'); response.end(index);
  });
  return server;
}

async function start(): Promise<void> {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? '8787');
  const publicOrigin = process.env.PUBLIC_ORIGIN;
  const recipient = process.env.ROUTE_DESTINATION_RECIPIENT;
  if (!publicOrigin || !recipient) throw new Error('PUBLIC_ORIGIN and ROUTE_DESTINATION_RECIPIENT are required');
  const parsedOrigin = new URL(publicOrigin);
  if (parsedOrigin.origin !== publicOrigin || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) throw new Error('PUBLIC_ORIGIN must be an exact origin without a path');
  if (process.env.NODE_ENV === 'production' && (parsedOrigin.protocol !== 'https:' || process.env.TRUST_PROXY !== '1')) throw new Error('Production requires an HTTPS PUBLIC_ORIGIN and TRUST_PROXY=1');
  if (!isFullEvmAddress(recipient) || /^0x0{40}$/i.test(recipient)) throw new Error('ROUTE_DESTINATION_RECIPIENT must be a non-zero complete Base address');
  const pool = createPostgresPool();
  const server = createApplicationServer({ store: new PostgresPublicOrderRequestStore(pool), publicOrigin, destinationRecipient: recipient, requireProxyHttps: process.env.NODE_ENV === 'production', trustProxy: process.env.TRUST_PROXY === '1' });
  server.listen(port, host, () => process.stdout.write(`${JSON.stringify({ level: 'info', event: 'server_started', host, port })}\n`));
  const shutdown = () => server.close(() => { void pool.end().finally(() => process.exit(0)); });
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) void start().catch(error => {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'server_start_failed', message: error instanceof Error ? error.message : 'unknown' })}\n`);
  process.exitCode = 1;
});
