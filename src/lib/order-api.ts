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
  status: 'AWAITING_OPERATOR' | 'PAYMENT_READY' | 'LINKED' | 'EXPIRED' | 'CANCELLED';
  createdAt: string;
  expiresAt: string;
  destinationRecipient: string;
  terms: PublicRouteTerms;
  linkedOrderId?: string;
  paymentInstructions?: { receiver: string; expiresAt: string };
};

export type PublicCapabilities = {
  apiVersion: 'v1';
  execution: 'operator-approved-testnet-only';
  route: PublicRouteTerms;
  destinationRecipient: string;
};

let csrfToken: string | undefined;

async function parse<T>(response: Response): Promise<T> {
  const value = await response.json() as T & { error?: string | { message?: string } };
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : value.error?.message ?? 'Request failed');
  return value;
}

async function csrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  csrfToken = (await parse<{ csrfToken: string }>(await fetch('/api/v1/session', { credentials: 'same-origin' }))).csrfToken;
  return csrfToken;
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
