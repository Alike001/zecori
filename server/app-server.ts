import { createReadStream } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PublicOrderRequestStore } from './public-order-store.ts';
import { PostgresPublicOrderRequestStore } from './public-order-store.ts';
import { createPostgresPool } from './postgres.ts';
import { publicApi } from './public-api.ts';
import { loadEncryptionKeyring } from './data-encryption.ts';
import { PostgresPasskeyAuth, type UserIdentityService } from './user-auth.ts';
import { createAgentGateway, type AgentGateway } from './agent-gateway.ts';
import { loadAgentProvider } from './agent-provider.ts';
import { PostgresDestinationWalletControl, UnavailableDestinationWalletControl, type DestinationWalletControlService } from './destination-wallet-control-store.ts';
import { contractWalletPolicy, createBaseSepoliaWalletControlVerifier } from './wallet-control.ts';
import { PostgresPrivyIdentity, type PrivyIdentityService } from './privy-auth.ts';
import { loadSpeechProvider, type SpeechProvider, type SpeechStatus } from './speech-provider.ts';
import { MemoryUserFeatures, PostgresUserFeatures, type UserFeatureService } from './user-features.ts';

export type ApplicationServerOptions = {
  store: PublicOrderRequestStore;
  auth: UserIdentityService;
  publicOrigin: string;
  staticDirectory?: string;
  requireProxyHttps?: boolean;
  trustProxy?: boolean;
  rateLimit?: { windowMs: number; maximum: number };
  agentRateLimit?: { windowMs: number; maximum: number };
  agent?: AgentGateway;
  speech?: SpeechProvider;
  speechStatus?: SpeechStatus;
  walletControl?: DestinationWalletControlService;
  contractWalletsEnabled?: boolean;
  privy?: PrivyIdentityService;
  privyAppId?: string;
  userFeatures?: UserFeatureService;
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

function securityHeaders(response: ServerResponse, privyEnabled: boolean): void {
  const policy = privyEnabled
    ? "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://auth.privy.io https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://auth.privy.io; font-src 'self' data:; child-src https://auth.privy.io; frame-src https://auth.privy.io https://challenges.cloudflare.com; connect-src 'self' https://auth.privy.io; worker-src 'self'; manifest-src 'self'"
    : "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'";
  response.setHeader('content-security-policy', policy);
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('permissions-policy', 'camera=(), geolocation=(), microphone=(self)');
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
  const agentLimiter = new RateLimiter(options.agentRateLimit?.windowMs ?? 60_000, options.agentRateLimit?.maximum ?? 10);
  const handleLimiter = new RateLimiter(60_000, 10);
  const walletControl = options.walletControl ?? new UnavailableDestinationWalletControl();
  const userFeatures = options.userFeatures ?? new MemoryUserFeatures();
  const api = publicApi(options.store, { allowedOrigin: options.publicOrigin, secureCookies: Boolean(options.requireProxyHttps), auth: options.auth, agent: options.agent ?? createAgentGateway(), userFeatures, ...(options.speech ? { speech: options.speech } : {}), ...(options.speechStatus ? { speechStatus: options.speechStatus } : {}), walletControl, contractWalletsEnabled: Boolean(options.contractWalletsEnabled), ...(options.privy ? { privy: options.privy, privyAppId: options.privyAppId } : {}) });
  const server = createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 5_000 }, async (request, response) => {
    securityHeaders(response, Boolean(options.privy));
    const url = new URL(request.url ?? '/', 'http://internal');
    if (url.pathname === '/health/live') return json(response, 200, { status: 'live' });
    if (url.pathname === '/health/ready') {
      try { await access(join(staticDirectory, 'index.html')); await Promise.all([options.store.health(), options.auth.health(), walletControl.health(), userFeatures.health()]); return json(response, 200, { status: 'ready' }); }
      catch { return json(response, 503, { status: 'not-ready' }); }
    }
    const limit = limiter.accept(clientKey(request, Boolean(options.trustProxy)));
    response.setHeader('ratelimit-limit', String(options.rateLimit?.maximum ?? 60));
    response.setHeader('ratelimit-remaining', String(limit.remaining));
    response.setHeader('ratelimit-reset', String(Math.ceil(limit.reset / 1000)));
    if (!limit.allowed) return json(response, 429, { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } });
    if (options.requireProxyHttps && request.headers['x-forwarded-proto'] !== 'https') return json(response, 400, { error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required.' } });
    if (url.pathname === '/api/v1/agent/messages' || url.pathname.startsWith('/api/v1/voice/')) {
      const agentLimit = agentLimiter.accept(`agent:${clientKey(request, Boolean(options.trustProxy))}`);
      response.setHeader('x-agent-ratelimit-limit', String(options.agentRateLimit?.maximum ?? 10));
      response.setHeader('x-agent-ratelimit-remaining', String(agentLimit.remaining));
      if (!agentLimit.allowed) return json(response, 429, { error: { code: 'AGENT_RATE_LIMITED', message: 'Too many assistant requests.' } });
    }
    if (url.pathname.startsWith('/api/v1/handles') || url.pathname.startsWith('/api/v1/contacts') || url.pathname.startsWith('/api/v1/handle-requests') || url.pathname === '/api/v1/account/handle') {
      const handleLimit = handleLimiter.accept(`handle:${clientKey(request, Boolean(options.trustProxy))}`);
      response.setHeader('x-handle-ratelimit-limit', '10'); response.setHeader('x-handle-ratelimit-remaining', String(handleLimit.remaining));
      if (!handleLimit.allowed) return json(response, 429, { error: { code: 'HANDLE_RATE_LIMITED', message: 'Too many handle requests.' } });
    }
    if (await api(request, response)) return;
    if (!['GET', 'HEAD'].includes(request.method ?? '')) return json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } });
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); } catch { return json(response, 400, { error: { code: 'INVALID_PATH', message: 'Invalid path.' } }); }
    if (pathname !== '/' && await serveFile(response, staticDirectory, pathname)) return;
    const index = await readFile(join(staticDirectory, 'index.html'));
    response.statusCode = 200; response.setHeader('content-type', 'text/html; charset=utf-8'); response.setHeader('cache-control', 'no-cache'); response.end(index);
  });
  const outboxTimer = setInterval(() => { void userFeatures.dispatchOutbox().catch(() => undefined); }, 5_000);
  outboxTimer.unref(); server.once('close', () => clearInterval(outboxTimer));
  return server;
}

async function start(): Promise<void> {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? '8787');
  const publicOrigin = process.env.PUBLIC_ORIGIN;
  if (!publicOrigin) throw new Error('PUBLIC_ORIGIN is required');
  const parsedOrigin = new URL(publicOrigin);
  if (parsedOrigin.origin !== publicOrigin || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) throw new Error('PUBLIC_ORIGIN must be an exact origin without a path');
  if (process.env.NODE_ENV === 'production' && (parsedOrigin.protocol !== 'https:' || process.env.TRUST_PROXY !== '1')) throw new Error('Production requires an HTTPS PUBLIC_ORIGIN and TRUST_PROXY=1');
  if (process.env.NODE_ENV !== 'production' && parsedOrigin.protocol !== 'https:' && !(parsedOrigin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname))) throw new Error('Development WebAuthn requires HTTPS or a loopback localhost origin');
  const configuredRpId = process.env.WEBAUTHN_RP_ID;
  if (process.env.NODE_ENV === 'production' && !configuredRpId) throw new Error('Production requires an explicit WEBAUTHN_RP_ID');
  const rpId = configuredRpId ?? parsedOrigin.hostname;
  if (rpId.includes('://') || rpId.includes('/') || !(parsedOrigin.hostname === rpId || parsedOrigin.hostname.endsWith(`.${rpId}`))) throw new Error('WEBAUTHN_RP_ID must equal the public hostname or be its registrable parent domain');
  const pool = createPostgresPool();
  const encryption = await loadEncryptionKeyring();
  const auth = new PostgresPasskeyAuth(pool, { rpName: 'Zecori', rpId, expectedOrigin: publicOrigin, secureCookies: process.env.NODE_ENV === 'production' });
  const privyFlag = process.env.PRIVY_AUTH_ENABLED ?? '0';
  if (!['0', '1'].includes(privyFlag)) throw new Error('PRIVY_AUTH_ENABLED must be exactly 0 or 1');
  let privy: PostgresPrivyIdentity | undefined;
  let privyAppId: string | undefined;
  if (privyFlag === '1') {
    privyAppId = process.env.PRIVY_APP_ID?.trim();
    const verificationKeyFile = process.env.PRIVY_VERIFICATION_KEY_FILE?.trim();
    if (!privyAppId || !verificationKeyFile) throw new Error('Enabled Privy authentication requires PRIVY_APP_ID and PRIVY_VERIFICATION_KEY_FILE');
    const verificationKey = (await readFile(verificationKeyFile, 'utf8')).trim();
    if (!verificationKey) throw new Error('Privy verification key file is empty');
    privy = new PostgresPrivyIdentity(pool, { appId: privyAppId, verificationKey });
  }
  const agentProvider = await loadAgentProvider();
  const speech = await loadSpeechProvider();
  const walletPolicy = contractWalletPolicy(process.env.ZECATHON_ERC1271_ENABLED);
  const walletVerifier = createBaseSepoliaWalletControlVerifier(process.env.BASE_SEPOLIA_RPC_URL, walletPolicy);
  if (!walletVerifier) throw new Error('BASE_SEPOLIA_RPC_URL is required for destination wallet verification');
  const agentRequestsPerMinute = Number(process.env.AI_AGENT_REQUESTS_PER_MINUTE ?? '10');
  if (!Number.isSafeInteger(agentRequestsPerMinute) || agentRequestsPerMinute < 1 || agentRequestsPerMinute > 60) throw new Error('AI_AGENT_REQUESTS_PER_MINUTE must be an integer from 1 to 60.');
  const server = createApplicationServer({ store: new PostgresPublicOrderRequestStore(pool, encryption), auth, userFeatures: new PostgresUserFeatures(pool, encryption), walletControl: new PostgresDestinationWalletControl(pool, encryption, walletVerifier), contractWalletsEnabled: walletPolicy.allowContractWallets, agent: createAgentGateway(agentProvider.provider, agentProvider.status.model, { maxProviderCalls: agentProvider.maxProviderCalls, maxOutputTokens: agentProvider.status.limits.maxOutputTokens, status: agentProvider.status }), ...(speech.provider ? { speech: speech.provider } : {}), speechStatus: speech.status, agentRateLimit: { windowMs: 60_000, maximum: agentRequestsPerMinute }, publicOrigin, requireProxyHttps: process.env.NODE_ENV === 'production', trustProxy: process.env.TRUST_PROXY === '1', ...(privy ? { privy, privyAppId } : {}) });
  server.listen(port, host, () => process.stdout.write(`${JSON.stringify({ level: 'info', event: 'server_started', host, port })}\n`));
  const shutdown = () => server.close(() => { void pool.end().finally(() => process.exit(0)); });
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) void start().catch(error => {
  process.stderr.write(`${JSON.stringify({ level: 'error', event: 'server_start_failed', message: error instanceof Error ? error.message : 'unknown' })}\n`);
  process.exitCode = 1;
});
