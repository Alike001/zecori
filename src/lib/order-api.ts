import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

export type PublicRouteTerms = {
  source: { network: 'zcash-testnet'; asset: 'TAZ'; pool: 'ironwood'; amountZatoshis: '1000000'; amount: '0.01'; confirmations: 10 };
  destination: { network: 'base-sepolia'; chainId: 84532; asset: 'USDC'; contract: string; amountAtomic: '1000000'; amount: '1'; confirmations: 3 };
  provider: { id: string; model: 'trusted-liquidity-provider' };
  rate: { description: string };
  custody: string;
  refunds: string;
};

export type PublicOrderRequest = {
  id: string;
  status: 'AWAITING_OPERATOR' | 'ACCEPTED' | 'PAYMENT_READY' | 'SOURCE_DETECTED' | 'SOURCE_CONFIRMED' | 'PAYOUT_AWAITING_APPROVAL' | 'PAYOUT_SUBMITTED' | 'COMPLETED' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED' | 'UNRESOLVED' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
  expiresAt: string;
  destinationRecipient: string;
  terms: PublicRouteTerms;
  linkedOrderId?: string;
  paymentInstructions?: { receiver: string; expiresAt: string };
  order?: { finalReceiptId?: string; resolutionReason?: string };
  timeline?: Array<{ type: string; at: string; actor: string; details: Record<string, unknown> }>;
};

export type PublicCapabilities = {
  apiVersion: 'v1';
  execution: 'operator-approved-testnet-only';
  route: PublicRouteTerms;
  destinationRecipient: string;
};

let csrfToken: string | undefined;

export type UserSession = { authenticated: boolean; user?: { id: string; displayName: string; passkeyCount: number }; csrfToken?: string };

async function parse<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { error?: string | { message?: string } };
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message ?? 'Request failed');
  return value;
}

async function csrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const session = await getSession();
  if (!session.authenticated || !session.csrfToken) throw new Error('Passkey authentication is required');
  csrfToken = session.csrfToken;
  return csrfToken;
}

export async function getSession(): Promise<UserSession> {
  const session = await parse<UserSession>(await fetch('/api/v1/session', { credentials: 'same-origin' }));
  csrfToken = session.csrfToken;
  return session;
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  return parse<T>(await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) }, body: JSON.stringify(body) }));
}

export async function registerPasskey(displayName: string, passkeyLabel: string, adding = false): Promise<void> {
  const token = adding ? await csrf() : undefined;
  const ceremony = await post<{ challengeId: string; passkeyLabel: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/api/v1/auth/register/options', { displayName, passkeyLabel }, token);
  const response = await startRegistration({ optionsJSON: ceremony.options });
  await post('/api/v1/auth/register/verify', { challengeId: ceremony.challengeId, passkeyLabel: ceremony.passkeyLabel, response }, token);
  csrfToken = undefined;
}

export async function loginWithPasskey(): Promise<void> {
  const ceremony = await post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('/api/v1/auth/login/options', {});
  const response = await startAuthentication({ optionsJSON: ceremony.options });
  await post('/api/v1/auth/login/verify', { challengeId: ceremony.challengeId, response });
  csrfToken = undefined;
}

export async function logout(): Promise<void> {
  await post('/api/v1/auth/logout', {}, await csrf()); csrfToken = undefined;
}

export async function getCapabilities(): Promise<PublicCapabilities> {
  return parse(await fetch('/api/v1/capabilities', { credentials: 'same-origin' }));
}

export async function listOrderRequests(): Promise<PublicOrderRequest[]> {
  return (await parse<{ requests: PublicOrderRequest[] }>(await fetch('/api/v1/order-requests', { credentials: 'same-origin' }))).requests;
}

export async function createOrderRequest(): Promise<PublicOrderRequest> {
  const token = await csrf();
  return (await parse<{ request: PublicOrderRequest }>(await fetch('/api/v1/order-requests', {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': token }, body: '{}',
  }))).request;
}

export async function getOrderRequest(id: string): Promise<PublicOrderRequest> {
  return (await parse<{ request: PublicOrderRequest }>(await fetch(`/api/v1/order-requests/${encodeURIComponent(id)}`, { credentials: 'same-origin' }))).request;
}
