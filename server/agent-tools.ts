import type { PublicOrderRequest, PublicOrderRequestStore } from './public-order-store.ts';
import { PUBLIC_ROUTE_TERMS } from './public-order-store.ts';
import { supportedRoutesToolResult } from './route-registry.ts';

export const AGENT_TOOL_NAMES = [
  'get_supported_routes',
  'compare_verified_quotes',
  'explain_shielded_privacy',
  'prepare_swap_request',
  'get_user_orders',
  'get_order_status',
  'explain_transaction_failure',
  'get_authorized_receipt',
  'explain_supported_zcash_services',
] as const;

export type AgentToolName = typeof AGENT_TOOL_NAMES[number];

export type AgentToolDefinition = {
  type: 'function';
  name: AgentToolName;
  description: string;
  strict: true;
  parameters: { readonly type: 'object'; readonly properties: Readonly<Record<string, unknown>>; readonly required: readonly string[]; readonly additionalProperties: false };
};

const emptyParameters = { type: 'object', properties: {}, required: [], additionalProperties: false } as const;
const requestParameters = {
  type: 'object', properties: { requestId: { type: 'string', description: 'The exact request UUID supplied by the application.' } },
  required: ['requestId'], additionalProperties: false,
} as const;
const receiptParameters = {
  type: 'object', properties: { receiptId: { type: 'string', description: 'The exact receipt UUID supplied by the application.' } },
  required: ['receiptId'], additionalProperties: false,
} as const;

export const AGENT_TOOLS: AgentToolDefinition[] = [
  { type: 'function', name: 'get_supported_routes', description: 'Return only routes registered by this application.', strict: true, parameters: emptyParameters },
  { type: 'function', name: 'compare_verified_quotes', description: 'Compare genuine verified quote data. Reports unavailable when no live quotes exist.', strict: true, parameters: emptyParameters },
  { type: 'function', name: 'explain_shielded_privacy', description: 'Explain the reviewed privacy and custody boundaries of the supported Zcash route.', strict: true, parameters: emptyParameters },
  { type: 'function', name: 'prepare_swap_request', description: 'Prepare a non-binding preview of the registered route. Never creates or authorizes an order.', strict: true, parameters: emptyParameters },
  { type: 'function', name: 'get_user_orders', description: 'List redacted requests owned by the authenticated account.', strict: true, parameters: emptyParameters },
  { type: 'function', name: 'get_order_status', description: 'Read a redacted request status when the authenticated account owns it.', strict: true, parameters: requestParameters },
  { type: 'function', name: 'explain_transaction_failure', description: 'Explain a controlled failure or recovery state for an owned request.', strict: true, parameters: requestParameters },
  { type: 'function', name: 'get_authorized_receipt', description: 'Return an owned receipt in its redacted shareable form. Private settlement evidence is never sent to the model.', strict: true, parameters: receiptParameters },
  { type: 'function', name: 'explain_supported_zcash_services', description: 'Describe the Zcash services the application actually supports and its explicit exclusions.', strict: true, parameters: emptyParameters },
];

export type AgentToolContext = { store: PublicOrderRequestStore; userId?: string };

function forbidden(message: string): never {
  throw Object.assign(new Error(message), { code: 'AGENT_TOOL_FORBIDDEN', statusCode: 403 });
}

function authenticated(context: AgentToolContext): string {
  if (!context.userId) throw Object.assign(new Error('Passkey authentication is required for account-scoped tools.'), { code: 'AUTHENTICATION_REQUIRED', statusCode: 401 });
  return context.userId;
}

function exactKeys(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Tool arguments must be an object.');
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error('Tool arguments do not match the registered schema.');
  return record;
}

function uuidArgument(value: unknown, key: string): string {
  const record = exactKeys(value, [key]);
  const candidate = record[key];
  if (typeof candidate !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)) throw new Error(`${key} must be a UUID.`);
  return candidate;
}

function redactedStatus(request: PublicOrderRequest) {
  return {
    requestId: request.id,
    status: request.status,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    receiptAvailable: Boolean(request.order?.finalReceiptId),
    ...(request.order?.finalReceiptId ? { receiptId: request.order.finalReceiptId } : {}),
    timeline: request.timeline?.slice(-20).map(event => ({ type: event.type, at: event.at, actor: event.actor })) ?? [],
  };
}

async function ownedRequest(context: AgentToolContext, requestId: string): Promise<PublicOrderRequest> {
  const found = await context.store.get(authenticated(context), requestId);
  if (!found) throw Object.assign(new Error('Request was not found for this account.'), { code: 'REQUEST_NOT_FOUND', statusCode: 404 });
  return found;
}

export async function executeAgentTool(name: string, argumentsValue: unknown, context: AgentToolContext): Promise<unknown> {
  if (!AGENT_TOOL_NAMES.includes(name as AgentToolName)) forbidden('The requested tool is not registered.');
  if (name === 'get_supported_routes') {
    exactKeys(argumentsValue, []);
    return supportedRoutesToolResult();
  }
  if (name === 'compare_verified_quotes') {
    exactKeys(argumentsValue, []);
    return { available: false, reason: 'No live provider quote feed is configured. The registered fixed test terms are not a market quote.', registeredTerms: PUBLIC_ROUTE_TERMS };
  }
  if (name === 'explain_shielded_privacy') {
    exactKeys(argumentsValue, []);
    return {
      sourcePool: PUBLIC_ROUTE_TERMS.source.pool,
      privacy: 'The source uses a dedicated Ironwood shielded receiver. Public receipts redact both chain transaction identifiers, exact settlement amounts and settlement timestamps.',
      limits: 'The trusted liquidity provider and authorized verification components can correlate the order, dedicated receiver, source evidence and public Base payout. A supplied shielded memo is readable by the receiver, so payment instructions require no memo. Shielding is not anonymity from the provider.',
    };
  }
  if (name === 'prepare_swap_request') {
    exactKeys(argumentsValue, []);
    return { previewOnly: true, terms: PUBLIC_ROUTE_TERMS, nextStep: 'The user must sign in and explicitly request operator review in the application.', createsOrder: false, authorizesPayment: false };
  }
  if (name === 'get_user_orders') {
    exactKeys(argumentsValue, []);
    const requests = await context.store.list(authenticated(context));
    return { requests: requests.slice(0, 20).map(request => ({ requestId: request.id, status: request.status, createdAt: request.createdAt, expiresAt: request.expiresAt, receiptAvailable: Boolean(request.order?.finalReceiptId) })) };
  }
  if (name === 'get_order_status') return redactedStatus(await ownedRequest(context, uuidArgument(argumentsValue, 'requestId')));
  if (name === 'explain_transaction_failure') {
    const request = await ownedRequest(context, uuidArgument(argumentsValue, 'requestId'));
    const rawReason = request.order?.resolutionReason;
    const failureCode = typeof rawReason === 'string' && /^[a-z0-9_-]{1,64}$/i.test(rawReason) ? rawReason : 'unspecified';
    const recoveryByStatus: Partial<Record<PublicOrderRequest['status'], string>> = {
      FAILED: 'Contact support with the request ID. Do not resend funds.',
      REFUND_PENDING: 'Wait for manual operator review. Refunds are not automatic.',
      UNRESOLVED: 'Manual evidence review is required. Do not resend funds.',
      EXPIRED: 'Create a new request only after confirming no payment was sent.',
      CANCELLED: 'This request cannot be resumed. Confirm no payment was sent before starting again.',
    };
    return { ...redactedStatus(request), failureCode, guidance: recoveryByStatus[request.status] ?? 'The request is not currently in a terminal failure state.' };
  }
  if (name === 'get_authorized_receipt') {
    const receiptId = uuidArgument(argumentsValue, 'receiptId');
    const requests = await context.store.list(authenticated(context));
    if (!requests.some(request => request.order?.finalReceiptId === receiptId)) forbidden('The receipt is not authorized for this account.');
    const receipt = await context.store.getShareableReceipt(receiptId);
    if (!receipt) throw Object.assign(new Error('Verified receipt was not found.'), { code: 'RECEIPT_NOT_FOUND', statusCode: 404 });
    return { receipt, disclosure: 'This is the redacted shareable receipt. Private shielded evidence was not sent to the model.' };
  }
  exactKeys(argumentsValue, []);
  return {
    supported: ['fixed Zcash testnet TAZ to Base Sepolia test USDC request previews', 'owner-scoped status tracking', 'redacted verified receipts', 'shielded privacy explanations'],
    unsupported: ['mainnet transfers', 'wallet balances', 'address generation', 'wallet unlocking', 'signing', 'broadcasting', 'automatic payouts', 'automatic refunds'],
  };
}
