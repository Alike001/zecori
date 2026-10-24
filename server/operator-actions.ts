import type { RpcCall } from './rpc-client.ts';
import { FileOrderStore } from './order-api.ts';
import { OperatorControlStore } from './operator-control.ts';

/**
 * Future operator-only mutation. Never imported by the browser API or invoked by preflight.
 * Its deterministic, pre-journaled diversifier makes retry after interruption idempotent.
 */
export async function executeAuthorizedAddressAllocation(input: {
  authorizationId: string;
  orderId: string;
  operatorId: string;
  controls?: OperatorControlStore;
  orders?: FileOrderStore;
  rpc?: RpcCall;
}): Promise<string> {
  void input;
  throw new Error('Legacy JSON address allocation is disabled; use the PostgreSQL settlement operator allocation bridge');
}

export async function executeAuthorizedPayoutApproval(input: {
  authorizationId: string;
  operatorId: string;
  ownerId: string;
  orderId: string;
  controls?: OperatorControlStore;
  orders?: FileOrderStore;
}): Promise<void> {
  const controls = input.controls ?? new OperatorControlStore();
  const orders = input.orders ?? new FileOrderStore();
  const target = `${input.ownerId}:${input.orderId}`;
  await controls.begin({ authorizationId: input.authorizationId, action: 'PAYOUT_APPROVAL', target, operatorId: input.operatorId });
  await orders.approvePayout(input.ownerId, input.orderId, { operatorId: input.operatorId, authorizationId: input.authorizationId });
  await controls.completePayoutAuthorization(input.authorizationId);
}
