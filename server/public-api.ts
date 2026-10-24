import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PublicOrderRequestStore } from './public-order-store.ts';
import { PUBLIC_ROUTE_TERMS } from './public-order-store.ts';

type ApiOptions = {
  allowedOrigin: string;
  destinationRecipient: string;
  secureCookies: boolean;
};

type Session = { ownerId: string; csrfToken: string };

function cookie(request: IncomingMessage, name: string): string | undefined {
  return request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

function setCookies(response: ServerResponse, session: Session, secure: boolean): void {
  const secureFlag = secure ? '; Secure' : '';
  response.setHeader('set-cookie', [
    `zecathon_session=${session.ownerId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secureFlag}`,
    `zecathon_csrf=${session.csrfToken}; SameSite=Strict; Path=/; Max-Age=86400${secureFlag}`,
  ]);
}

function getSession(request: IncomingMessage, response: ServerResponse, secure: boolean): Session {
  const owner = cookie(request, 'zecathon_session');
  const csrf = cookie(request, 'zecathon_csrf');
  if (owner && csrf && /^[0-9a-f]{64}$/.test(owner) && /^[0-9a-f]{64}$/.test(csrf)) return { ownerId: owner, csrfToken: csrf };
  const created = { ownerId: randomBytes(32).toString('hex'), csrfToken: randomBytes(32).toString('hex') };
  setCookies(response, created, secure);
  return created;
}

function sameValue(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

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

async function requireEmptyJson(request: IncomingMessage): Promise<void> {
  let bytes = 0; let raw = '';
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 4_096) throw new Error('Request body exceeds 4096 bytes');
    raw += buffer.toString('utf8');
  }
  if (!raw.trim()) return;
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).length !== 0) throw new Error('This route accepts only an empty JSON object');
}

export function publicApi(store: PublicOrderRequestStore, options: ApiOptions) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://internal');
    if (!url.pathname.startsWith('/api/')) return false;
    const requestId = randomUUID();
    response.setHeader('x-request-id', requestId);
    if (!url.pathname.startsWith('/api/v1/')) {
      error(response, 404, 'API_VERSION_REQUIRED', 'Use the /api/v1 API.', requestId); return true;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (request.headers.origin !== options.allowedOrigin) {
        error(response, 403, 'ORIGIN_REJECTED', 'The request origin is not allowed.', requestId); return true;
      }
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        error(response, 415, 'CONTENT_TYPE_REQUIRED', 'Use application/json.', requestId); return true;
      }
    }
    const session = getSession(request, response, options.secureCookies);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !sameValue(csrf, session.csrfToken)) {
        error(response, 403, 'CSRF_REJECTED', 'A valid session CSRF token is required.', requestId); return true;
      }
    }
    try {
      if (request.method === 'GET' && url.pathname === '/api/v1/session') {
        writeJson(response, 200, { csrfToken: session.csrfToken }); return true;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/capabilities') {
        writeJson(response, 200, { apiVersion: 'v1', execution: 'operator-approved-testnet-only', route: PUBLIC_ROUTE_TERMS, destinationRecipient: options.destinationRecipient }); return true;
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/order-requests') {
        writeJson(response, 200, { requests: await store.list(session.ownerId) }); return true;
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/order-requests') {
        await requireEmptyJson(request);
        const created = await store.create(session.ownerId, options.destinationRecipient);
        writeJson(response, 202, { request: created }); return true;
      }
      const match = url.pathname.match(/^\/api\/v1\/order-requests\/([0-9a-f-]{36})$/i);
      if (request.method === 'GET' && match) {
        const found = await store.get(session.ownerId, match[1]);
        if (!found) error(response, 404, 'REQUEST_NOT_FOUND', 'Payment request not found.', requestId);
        else writeJson(response, 200, { request: found });
        return true;
      }
      const privateReceipt = url.pathname.match(/^\/api\/v1\/receipts\/([0-9a-f-]{36})\/private$/i);
      if (request.method === 'GET' && privateReceipt) {
        const found = await store.getPrivateReceipt(session.ownerId, privateReceipt[1]);
        if (!found) error(response, 404, 'RECEIPT_NOT_FOUND', 'Private receipt not found for this session.', requestId);
        else writeJson(response, 200, { receipt: found });
        return true;
      }
      const shareableReceipt = url.pathname.match(/^\/api\/v1\/receipts\/([0-9a-f-]{36})$/i);
      if (request.method === 'GET' && shareableReceipt) {
        const found = await store.getShareableReceipt(shareableReceipt[1]);
        if (!found) error(response, 404, 'RECEIPT_NOT_FOUND', 'Verified receipt not found.', requestId);
        else writeJson(response, 200, { receipt: found });
        return true;
      }
      error(response, 404, 'NOT_FOUND', 'API route not found.', requestId); return true;
    } catch (caught) {
      const message = caught instanceof SyntaxError ? 'Malformed JSON request body.' : caught instanceof Error ? caught.message : 'Request failed.';
      const unavailable = /ECONN|database|timeout|connection/i.test(message);
      error(response, unavailable ? 503 : 400, unavailable ? 'SERVICE_UNAVAILABLE' : 'INVALID_REQUEST', unavailable ? 'The service is temporarily unavailable.' : message, requestId);
      return true;
    }
  };
}
