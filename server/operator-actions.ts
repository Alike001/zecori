import { exactJsonInteger, type RpcCall } from './rpc-client.ts';
import { FileOrderStore } from './order-api.ts';
import { OperatorControlStore } from './operator-control.ts';
import { validateUnusedWalletBAddress } from './zcash-address-allocator.ts';
import { walletBRpc } from './zcash-verifier.ts';

type DerivedAddress = { address?: string; diversifier_index?: number | string; receiver_types?: string[] };

function exactIndex(value: number | string | undefined): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value).toString();
  throw new Error('Derived address returned an invalid diversifier index');
}

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
  const controls = input.controls ?? new OperatorControlStore();
  const orders = input.orders ?? new FileOrderStore();
  const prepared = await orders.operatorOrderManifest(input.orderId);
  if (prepared.operatorId !== input.operatorId) throw new Error('Operator identity does not match the prepared order');
  await controls.verifyOrderManifest(prepared.binding, prepared.operatorId, prepared.manifestSignature);
  const existingRecovery = (await controls.inspect()).allocations.find(item => item.authorizationId === input.authorizationId);
  if (Date.parse(prepared.binding.expiresAt) <= Date.now() && !existingRecovery) throw new Error('Prepared operator order expired before address allocation began');
  await controls.begin({ authorizationId: input.authorizationId, action: 'ADDRESS_ALLOCATION', target: `order:${input.orderId}`, operatorId: input.operatorId, orderBinding: prepared.binding });
  let record = (await controls.inspect()).allocations.find(item => item.authorizationId === input.authorizationId);
  if (!record) throw new Error('Allocation recovery record is missing');
  if (record.orderId !== input.orderId) throw new Error('Allocation recovery record is bound to a different order');
  if (record.state === 'RESERVED') {
    const current = await orders.operatorOrderManifest(input.orderId);
    if (current.allocationId !== record.allocationId || !['ADDRESS_ALLOCATED', 'ACTIVE'].includes(current.state)) throw new Error('Reserved allocation and operator order are inconsistent');
    return record.allocationId;
  }
  const rpc = input.rpc ?? await walletBRpc();
  if (record.state === 'DERIVATION_PENDING') {
    const derived = await rpc<DerivedAddress>('z_getaddressforaccount', [0, ['orchard'], exactJsonInteger(record.diversifierIndex)]);
    const returnedIndex = exactIndex(derived.diversifier_index);
    if (!derived.address || !/^utest1[a-z0-9]+$/.test(derived.address) || returnedIndex !== record.diversifierIndex || derived.receiver_types?.length !== 1 || derived.receiver_types[0] !== 'orchard') throw new Error('Derived address response does not match the authorized Orchard allocation');
    await controls.recordDerived(input.authorizationId, derived.address, returnedIndex);
    record = (await controls.inspect()).allocations.find(item => item.authorizationId === input.authorizationId);
  }
  if (!record?.address || record.state !== 'DERIVED') throw new Error('Derived allocation cannot be reconciled');
  await orders.bindReceivingAddressToPreparedOrder(input.orderId, record.address, address => validateUnusedWalletBAddress(address, { rpc, allocationId: record!.allocationId }));
  await controls.completeAddressAllocation(input.authorizationId);
  return record.allocationId;
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
