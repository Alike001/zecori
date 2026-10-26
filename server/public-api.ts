import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PublicOrderRequestStore } from './public-order-store.ts';
import { PUBLIC_ROUTE_TERMS } from './public-order-store.ts';
import { clearSessionCookies, sessionCookies, type AuthenticatedUser, type UserIdentityService } from './user-auth.ts';
import type { AgentGateway } from './agent-gateway.ts';
import { validateWalletReadinessIntent } from './wallet-intent.ts';
import type { DestinationWalletControlService } from './destination-wallet-control-store.ts';
import { bearerAccessToken, type PrivyIdentityService } from './privy-auth.ts';
import { ROUTE_CAPABILITIES } from '../src/lib/route-capabilities.ts';
import { PRODUCT_CAPABILITIES } from '../src/lib/product-capabilities.ts';
import { SPEECH_LIMITS, type SpeechProvider, type SpeechStatus } from './speech-provider.ts';

type ApiOptions = { allowedOrigin: string; secureCookies: boolean; auth: UserIdentityService; agent: AgentGateway; speech?: SpeechProvider; speechStatus?: SpeechStatus; walletControl: DestinationWalletControlService; contractWalletsEnabled?: boolean; privy?: PrivyIdentityService; privyAppId?: string };

function orderCreation(contractWalletsEnabled: boolean) { return Object.freeze({
  enabled: true as const,
  binding: 'encrypted-owner-scoped-v2' as const,
  walletControlVerification: contractWalletsEnabled ? 'required-eip712-or-erc1271' as const : 'required-eip712-eoa' as const,
}); }

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-content-type-options', 'nosniff');
  response.end(JSON.stringify(value));
}

function error(response: ServerResponse, status: number, code: string, message: string, requestId: string): void {
  writeJson(response, status, { error: { code, message, requestId } });
}

async function readJson(request: IncomingMessage, maximum = 65_536): Promise<Record<string, unknown>> {
  let bytes = 0; let raw = '';
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximum) throw new Error(`Request body exceeds ${maximum} bytes`);
    raw += buffer.toString('utf8');
  }
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Request body must be a JSON object');
  return parsed as Record<string, unknown>;
}

async function readBytes(request: IncomingMessage, maximum: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximum) throw Object.assign(new Error(`Audio exceeds the ${maximum} byte application limit.`), { statusCode: 413, code: 'AUDIO_TOO_LARGE' });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function requireSession(session: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!session) throw Object.assign(new Error('Authentication is required.'), { statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
  return session;
}

function requireCsrf(options: ApiOptions, session: AuthenticatedUser | undefined, request: IncomingMessage): AuthenticatedUser {
  const authenticated = requireSession(session);
  if (!options.auth.verifyCsrf(authenticated, request.headers['x-csrf-token'])) {
    throw Object.assign(new Error('A valid session CSRF token is required.'), { statusCode: 403, code: 'CSRF_REJECTED' });
  }
  return authenticated;
}

export function publicApi(store: PublicOrderRequestStore, options: ApiOptions) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://internal');
    if (!url.pathname.startsWith('/api/')) return false;
    const requestId = randomUUID(); response.setHeader('x-request-id', requestId);
    if (!url.pathname.startsWith('/api/v1/')) { error(response, 404, 'API_VERSION_REQUIRED', 'Use the /api/v1 API.', requestId); return true; }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (request.headers.origin !== options.allowedOrigin) { error(response, 403, 'ORIGIN_REJECTED', 'The request origin is not allowed.', requestId); return true; }
      const contentType = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
      const audioUpload = url.pathname === '/api/v1/voice/transcriptions' && contentType?.startsWith('audio/');
      if (!audioUpload && contentType !== 'application/json') { error(response, 415, 'CONTENT_TYPE_REQUIRED', audioUpload ? 'Use a supported audio content type.' : 'Use application/json.', requestId); return true; }
    }
    try {
      const session = await options.auth.session(request);
      if (request.method === 'GET' && url.pathname === '/api/v1/session') { writeJson(response, 200, options.auth.publicSession(session)); return true; }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/register/options') {
        const body = await readJson(request); if (session) requireCsrf(options, session, request);
        writeJson(response, 200, await options.auth.beginRegistration(body, session)); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/register/verify') {
        const body = await readJson(request); if (session) requireCsrf(options, session, request);
        const result = await options.auth.finishRegistration(body, session);
        response.setHeader('set-cookie', sessionCookies(result.session, options.secureCookies));
        writeJson(response, 200, { verified: true }); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/login/options') {
        await readJson(request, 4_096); writeJson(response, 200, await options.auth.beginAuthentication()); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/login/verify') {
        const result = await options.auth.finishAuthentication(await readJson(request), session);
        response.setHeader('set-cookie', sessionCookies(result.session, options.secureCookies));
        writeJson(response, 200, { verified: true }); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/privy/login') {
        if (!options.privy) throw Object.assign(new Error('Privy sign-in is disabled.'), { statusCode: 404, code: 'PRIVY_DISABLED' });
        await readJson(request, 1_024);
        const result = await options.privy.login(bearerAccessToken(request.headers.authorization), session);
        response.setHeader('set-cookie', sessionCookies(result.session, options.secureCookies));
        writeJson(response, 200, { verified: true, created: result.created }); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/privy/link') {
        if (!options.privy) throw Object.assign(new Error('Privy linking is disabled.'), { statusCode: 404, code: 'PRIVY_DISABLED' });
        const authenticated = requireCsrf(options, session, request); await readJson(request, 1_024);
        writeJson(response, 200, await options.privy.link(bearerAccessToken(request.headers.authorization), authenticated)); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
        const authenticated = requireCsrf(options, session, request); await readJson(request, 4_096); await options.auth.logout(authenticated);
        response.setHeader('set-cookie', clearSessionCookies(options.secureCookies)); writeJson(response, 200, { loggedOut: true }); return true;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/capabilities') {
        writeJson(response, 200, {
          apiVersion: 'v1', execution: 'operator-approved-testnet-only', route: PUBLIC_ROUTE_TERMS,
          routeId: 'zcash-testnet-to-base-sepolia-fixed', classification: 'fixed-test-terms',
          routes: ROUTE_CAPABILITIES,
          productCapabilities: PRODUCT_CAPABILITIES,
          authentication: { passkeys: true, guestExploration: true, privy: options.privy && options.privyAppId ? { enabled: true, appId: options.privyAppId, loginMethods: ['email', 'google'], embeddedWalletCreation: false, delegatedActions: false, serverSigning: false } : { enabled: false } },
          orderCreation: orderCreation(Boolean(options.contractWalletsEnabled)),
          wallets: {
            zcash: { network: 'zcash-testnet', pool: 'ironwood', connectedMode: 'read-only-capability-check', externalMode: true },
            base: { network: 'base-sepolia', chainId: 84532, contract: PUBLIC_ROUTE_TERMS.destination.contract, connectedMode: 'user-initiated-eip712', manualRecipient: true, addressIntentConfirmation: true, walletControlVerified: true, supportedProofs: options.contractWalletsEnabled ? ['EIP-712 EOA','ERC-1271 deployed contract'] : ['EIP-712 EOA'], contractWallets: options.contractWalletsEnabled ? 'experimental-enabled' : 'disabled-until-live-validation' },
          },
          agent: options.agent.status,
          voice: options.speechStatus ?? { enabled: false, provider: 'groq', reason: 'Voice is disabled.', externalRequestsApproved: false, liveValidated: false, transcription: { model: 'whisper-large-v3-turbo', locales: ['en','fr','ar'], providerDocumentationVerified: true }, synthesis: { locales: ['en','ar'], models: { en: 'canopylabs/orpheus-v1-english', ar: 'canopylabs/orpheus-arabic-saudi' }, providerDocumentationVerified: true }, limits: SPEECH_LIMITS, retention: 'memory-only-until-provider-response' },
        }); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/agent/messages') {
        if (session) requireCsrf(options, session, request);
        const body = await readJson(request, 8_192);
        const allowed = new Set(['message', 'locale']);
        if (Object.keys(body).some(key => !allowed.has(key))) throw new Error('Agent request contains unsupported fields.');
        if (typeof body.message !== 'string') throw new Error('Agent message is required.');
        const locale = body.locale ?? 'en';
        if (!['en', 'fr', 'ar'].includes(String(locale))) throw Object.assign(new Error('The requested language is not supported.'), { code: 'UNSUPPORTED_LANGUAGE' });
        const reply = await options.agent.respond(body.message, { store, ...(session ? { userId: session.userId } : {}) }, locale as 'en' | 'fr' | 'ar');
        writeJson(response, 200, { reply }); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/voice/transcriptions') {
        requireCsrf(options, session, request);
        if (!options.speech) throw Object.assign(new Error('Voice transcription is disabled.'), { statusCode: 503, code: 'VOICE_DISABLED' });
        if (request.headers['x-voice-consent'] !== 'audio-processing-and-retention-accepted') throw Object.assign(new Error('Explicit voice processing and retention consent is required.'), { statusCode: 403, code: 'VOICE_CONSENT_REQUIRED' });
        const locale = request.headers['x-speech-locale'];
        if (!['en', 'fr', 'ar'].includes(String(locale))) throw Object.assign(new Error('Speech recognition supports English, French, and Arabic input.'), { code: 'UNSUPPORTED_SPEECH_LANGUAGE' });
        const durationMs = Number(request.headers['x-audio-duration-ms']);
        if (!Number.isFinite(durationMs) || durationMs < SPEECH_LIMITS.minimumDurationMs) throw Object.assign(new Error('Recording is too short to transcribe.'), { statusCode: 422, code: 'AUDIO_TOO_SHORT' });
        if (durationMs > SPEECH_LIMITS.maximumDurationMs) throw Object.assign(new Error('Recording exceeds the 30 second limit.'), { statusCode: 413, code: 'AUDIO_TOO_LONG' });
        const contentType = request.headers['content-type']?.split(';')[0].trim().toLowerCase() ?? '';
        const audio = await readBytes(request, SPEECH_LIMITS.maximumAudioBytes);
        try { writeJson(response, 200, { transcript: await options.speech.transcribe(audio, contentType, locale as 'en' | 'fr' | 'ar'), canAuthorizePayment: false }); }
        finally { audio.fill(0); }
        return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/voice/speech') {
        requireCsrf(options, session, request);
        if (!options.speech) throw Object.assign(new Error('Voice output is disabled.'), { statusCode: 503, code: 'VOICE_DISABLED' });
        if (request.headers['x-voice-consent'] !== 'audio-processing-and-retention-accepted') throw Object.assign(new Error('Explicit voice processing and retention consent is required.'), { statusCode: 403, code: 'VOICE_CONSENT_REQUIRED' });
        const body = await readJson(request, 1_024);
        if (Object.keys(body).some(key => !['text', 'locale'].includes(key)) || typeof body.text !== 'string') throw new Error('Speech request is invalid.');
        if (body.locale !== 'en' && body.locale !== 'ar') throw Object.assign(new Error('Voice output is supported only for English and Arabic. Use text for this language.'), { statusCode: 422, code: 'VOICE_OUTPUT_UNSUPPORTED_LANGUAGE' });
        const audio = await options.speech.synthesize(body.text, body.locale);
        response.statusCode = 200; response.setHeader('content-type', 'audio/wav'); response.setHeader('cache-control', 'no-store'); response.setHeader('content-length', String(audio.byteLength)); response.end(audio); return true;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/order-requests') {
        const authenticated = requireSession(session); writeJson(response, 200, { requests: await store.list(authenticated.userId) }); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/order-requests') {
        const authenticated = requireCsrf(options, session, request); const body = await readJson(request, 4_096);
        const intent = validateWalletReadinessIntent(body);
        writeJson(response, 202, { request: await store.create(authenticated.userId, intent) }); return true;
      }
      const challenge = url.pathname.match(/^\/api\/v1\/order-requests\/([0-9a-f-]{36})\/destination-challenges$/i);
      if (request.method === 'POST' && challenge) {
        const authenticated = requireCsrf(options, session, request); await readJson(request, 1_024);
        writeJson(response, 201, { challenge: await options.walletControl.issue(authenticated, challenge[1], options.allowedOrigin) }); return true;
      }
      const proof = url.pathname.match(/^\/api\/v1\/destination-challenges\/([0-9a-f-]{36})\/verify$/i);
      if (request.method === 'POST' && proof) {
        const authenticated = requireCsrf(options, session, request); const body = await readJson(request, 20_000);
        const allowed = new Set(['signature']); if (Object.keys(body).some(key => !allowed.has(key))) throw new Error('Wallet proof contains unsupported fields.');
        writeJson(response, 200, { verification: await options.walletControl.verify(authenticated, proof[1], body.signature, options.allowedOrigin) }); return true;
      }
      const match = url.pathname.match(/^\/api\/v1\/order-requests\/([0-9a-f-]{36})$/i);
      if (request.method === 'GET' && match) {
        const found = await store.get(requireSession(session).userId, match[1]);
        if (!found) error(response, 404, 'REQUEST_NOT_FOUND', 'Payment request not found.', requestId); else writeJson(response, 200, { request: found }); return true;
      }
      const privateReceipt = url.pathname.match(/^\/api\/v1\/receipts\/([0-9a-f-]{36})\/private$/i);
      if (request.method === 'GET' && privateReceipt) {
        const found = await store.getPrivateReceipt(requireSession(session).userId, privateReceipt[1]);
        if (!found) error(response, 404, 'RECEIPT_NOT_FOUND', 'Private receipt not found for this account.', requestId); else writeJson(response, 200, { receipt: found }); return true;
      }
      const shareableReceipt = url.pathname.match(/^\/api\/v1\/receipts\/([0-9a-f-]{36})$/i);
      if (request.method === 'GET' && shareableReceipt) {
        const found = await store.getShareableReceipt(shareableReceipt[1]);
        if (!found) error(response, 404, 'RECEIPT_NOT_FOUND', 'Verified receipt not found.', requestId); else writeJson(response, 200, { receipt: found }); return true;
      }
      error(response, 404, 'NOT_FOUND', 'API route not found.', requestId); return true;
    } catch (caught) {
      const known = caught as Error & { statusCode?: number; code?: string };
      const message = caught instanceof SyntaxError ? 'Malformed JSON request body.' : known.message || 'Request failed.';
      const unavailable = /ECONN|database|timeout|connection/i.test(message); const status = known.statusCode ?? (unavailable ? 503 : 400);
      error(response, status, known.code ?? (unavailable ? 'SERVICE_UNAVAILABLE' : 'INVALID_REQUEST'), unavailable ? 'The service is temporarily unavailable.' : message, requestId); return true;
    }
  };
}
