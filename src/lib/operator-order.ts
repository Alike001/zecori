import { BASE_USDC, destinationAmountFor, isFullEvmAddress, routeProvider } from './order-coordinator.ts';

export type OperatorOrderBinding = {
  version: 1;
  orderId: string;
  providerId: string;
  sourceNetwork: 'zcash-testnet';
  sourcePool: 'ironwood';
  sourceAmountZat: '1000000';
  destinationNetwork: 'base-sepolia';
  destinationChainId: 84532;
  destinationTokenContract: typeof BASE_USDC;
  destinationAmountAtomic: '1000000';
  destinationRecipient: string;
  expiresAt: string;
};

export function createOperatorOrderBinding(input: { orderId: string; destinationRecipient: string; expiresAt: string; providerId?: string; now?: number }): OperatorOrderBinding {
  const now = input.now ?? Date.now();
  if (!/^[0-9a-f-]{20,}$/i.test(input.orderId)) throw new Error('Unique operator order ID is invalid');
  if (!isFullEvmAddress(input.destinationRecipient)) throw new Error('Operator-confirmed Base recipient is invalid');
  if (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= now) throw new Error('Operator order expiry must be in the future');
  const destinationAmountAtomic = destinationAmountFor('1000000');
  const provider = routeProvider(input.providerId);
  if (destinationAmountAtomic !== '1000000') throw new Error('Fixed route amount invariant failed');
  return {
    version: 1,
    orderId: input.orderId,
    providerId: provider.id,
    sourceNetwork: 'zcash-testnet',
    sourcePool: 'ironwood',
    sourceAmountZat: '1000000',
    destinationNetwork: 'base-sepolia',
    destinationChainId: 84532,
    destinationTokenContract: BASE_USDC,
    destinationAmountAtomic: '1000000',
    destinationRecipient: input.destinationRecipient,
    expiresAt: new Date(Date.parse(input.expiresAt)).toISOString(),
  };
}

export function canonicalOperatorOrderBinding(binding: OperatorOrderBinding): string {
  return JSON.stringify({
    version: binding.version,
    orderId: binding.orderId,
    providerId: binding.providerId,
    sourceNetwork: binding.sourceNetwork,
    sourcePool: binding.sourcePool,
    sourceAmountZat: binding.sourceAmountZat,
    destinationNetwork: binding.destinationNetwork,
    destinationChainId: binding.destinationChainId,
    destinationTokenContract: binding.destinationTokenContract.toLowerCase(),
    destinationAmountAtomic: binding.destinationAmountAtomic,
    destinationRecipient: binding.destinationRecipient.toLowerCase(),
    expiresAt: binding.expiresAt,
  });
}

export function sameOperatorOrderBinding(left: OperatorOrderBinding, right: OperatorOrderBinding): boolean {
  return canonicalOperatorOrderBinding(left) === canonicalOperatorOrderBinding(right);
}

export function validateOperatorOrderBinding(binding: OperatorOrderBinding, now = Date.now()): void {
  const expected = createOperatorOrderBinding({ orderId: binding.orderId, destinationRecipient: binding.destinationRecipient, expiresAt: binding.expiresAt, providerId: binding.providerId, now });
  if (!sameOperatorOrderBinding(binding, expected)) throw new Error('Operator order terms do not match the fixed testnet route');
}
