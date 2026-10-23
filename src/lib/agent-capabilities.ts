import type { PublicOrderRequest, PublicRouteTerms } from './order-api.ts';

export type AgentContext = { route?: PublicRouteTerms; request?: PublicOrderRequest };
export type AgentAction =
  | { capability: 'explain_privacy' }
  | { capability: 'query_supported_routes' }
  | { capability: 'draft_swap_request' }
  | { capability: 'explain_trust_and_fees' }
  | { capability: 'read_order_status'; requestId: string }
  | { capability: 'explain_settlement' };

export type AgentReply = { text: string; proposedAction?: AgentAction; refusal?: true };

const INJECTION = /(ignore|reveal|override|bypass).{0,30}(instruction|secret|policy|authorization|payout)|seed phrase|private key|approve payout|sign transaction/i;

export function respondToAgent(message: string, context: AgentContext): AgentReply {
  const input = message.trim();
  if (!input) return { text: 'Ask about the supported testnet route, privacy, custody, fees, or your current request.' };
  if (INJECTION.test(input)) return { text: 'I cannot reveal private data, override route policy, sign transactions, or approve payouts.', refusal: true };
  if (/privacy|shielded|ironwood/i.test(input)) return { text: 'The source payment uses a fresh Ironwood shielded receiver. Public views redact the receiver and source transaction correlation, but the trusted provider still observes the payment needed to settle this test route.', proposedAction: { capability: 'explain_privacy' } };
  if (/route|support|swap|quote/i.test(input) && context.route) return { text: `The only supported route is exactly ${context.route.source.amount} TAZ on Zcash testnet to ${context.route.destination.amount} test USDC on Base Sepolia. The fixed test rate is not a market quote.`, proposedAction: { capability: 'query_supported_routes' } };
  if (/draft|request/i.test(input) && context.route) return { text: `I can draft the fixed ${context.route.source.amount} TAZ → ${context.route.destination.amount} test USDC request for review. Creating it does not allocate an address or authorize a payment.`, proposedAction: { capability: 'draft_swap_request' } };
  if (/status|progress|settle|failed|expired/i.test(input)) {
    if (!context.request) return { text: 'There is no authorized request in this browser session yet.' };
    return { text: `Request ${context.request.id} is ${context.request.status.replaceAll('_', ' ').toLowerCase()}. Operator review, source verification, payout approval, and destination verification remain separate steps.`, proposedAction: { capability: 'read_order_status', requestId: context.request.id } };
  }
  if (/fee|custody|trust|refund/i.test(input) && context.route) return { text: `${context.route.custody} ${context.route.refunds} Network fees are not represented as a live quote in this milestone.`, proposedAction: { capability: 'explain_trust_and_fees' } };
  return { text: 'That intent is not supported. I can explain privacy, the fixed testnet route, custody, refunds, or the status of your current request.', refusal: true };
}
