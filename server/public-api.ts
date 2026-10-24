import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PublicOrderRequestStore } from './public-order-store.ts';
import { PUBLIC_ROUTE_TERMS } from './public-order-store.ts';
import { clearSessionCookies, sessionCookies, type AuthenticatedUser, type UserIdentityService } from './user-auth.ts';

type ApiOptions = { allowedOrigin: string; destinationRecipient: string; secureCookies: boolean; auth: UserIdentityService };

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

function requireSession(session: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!session) throw Object.assign(new Error('Passkey authentication is required.'), { statusCode: 401, code: 'AUTHENTICATION_REQUIRED' });
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
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') { error(response, 415, 'CONTENT_TYPE_REQUIRED', 'Use application/json.', requestId); return true; }
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
      if (request.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
        const authenticated = requireCsrf(options, session, request); await readJson(request, 4_096); await options.auth.logout(authenticated);
        response.setHeader('set-cookie', clearSessionCookies(options.secureCookies)); writeJson(response, 200, { loggedOut: true }); return true;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/capabilities') {
        writeJson(response, 200, { apiVersion: 'v1', execution: 'operator-approved-testnet-only', route: PUBLIC_ROUTE_TERMS, destinationRecipient: options.destinationRecipient }); return true;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/order-requests') {
        const authenticated = requireSession(session); writeJson(response, 200, { requests: await store.list(authenticated.userId) }); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/order-requests') {
        const authenticated = requireCsrf(options, session, request); const body = await readJson(request, 4_096);
        if (Object.keys(body).length !== 0) throw new Error('This route accepts only an empty JSON object');
        writeJson(response, 202, { request: await store.create(authenticated.userId, options.destinationRecipient) }); return true;
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
