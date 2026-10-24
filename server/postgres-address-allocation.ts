import type { RpcCall } from './rpc-client.ts';
import { walletBRpc } from './zcash-verifier.ts';
import { deriveExactOrchardAddress, validateUnusedWalletBAddress, validateUnusedWalletBDiversifier } from './zcash-address-allocator.ts';
import { randomDiversifierIndex } from './operator-control.ts';
import type { PostgresSettlementStore } from './postgres-settlement-store.ts';

type AuthorizationVerifier = (domain: 'allocation-authorization-v1' | 'payout-authorization-v1', canonicalPayload: string, signature: string) => Promise<void>;
type CrashHooks = Partial<Record<'afterJournal' | 'afterRpcStart' | 'afterDerivation' | 'afterDerivedRecord' | 'afterReservation', () => void | Promise<void>>>;

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown';
  if (/timeout|timed out/i.test(message)) return 'RPC_TIMEOUT';
  if (/disconnect|ECONN|socket|fetch failed/i.test(message)) return 'RPC_DISCONNECTED';
  if (/does not match|invalid|Orchard/i.test(message)) return 'RPC_RESPONSE_INVALID';
  return 'RPC_FAILURE';
}

export async function executePostgresAddressAllocation(input: {
  store: PostgresSettlementStore;
  authorizationId: string;
  orderId: string;
  operatorId: string;
  verifyAuthorization: AuthorizationVerifier;
  rpc?: RpcCall;
  mode?: 'EXECUTE' | 'RECONCILE';
  diversifierIndex?: string;
  now?: number;
  hooks?: CrashHooks;
}): Promise<string> {
  const rpc = input.rpc ?? await walletBRpc();
  const now = input.now ?? Date.now();
  let operation;
  try {
    operation = await input.store.addressAllocationOperation(input.orderId, input.authorizationId, input.operatorId);
    await input.store.authenticateAddressAllocation(input.orderId, input.authorizationId, input.operatorId, input.verifyAuthorization, now);
  } catch (error) {
    if (!(error instanceof Error) || !/not found/.test(error.message)) throw error;
    if (input.mode === 'RECONCILE') throw new Error('No durable allocation operation exists to reconcile');
    const diversifierIndex = input.diversifierIndex ?? randomDiversifierIndex();
    await validateUnusedWalletBDiversifier(diversifierIndex, { rpc, now });
    operation = await input.store.beginAddressAllocation(input.orderId, input.operatorId, input.authorizationId, diversifierIndex, input.verifyAuthorization, now);
    await input.hooks?.afterJournal?.();
  }
  if (operation.phase === 'CANCELLED') throw new Error('Allocation operation was cancelled before wallet RPC');
  if (operation.phase === 'RESERVED') return operation.allocationId;

  if (!operation.address) {
    operation = await input.store.markAddressDerivationStarted(input.orderId, input.authorizationId, input.operatorId, now);
    await input.hooks?.afterRpcStart?.();
    let derived: { address: string; diversifierIndex: string };
    try {
      derived = await deriveExactOrchardAddress(operation.diversifierIndex, rpc);
    } catch (error) {
      await input.store.markAddressDerivationUncertain(input.orderId, input.authorizationId, input.operatorId, errorCode(error), now);
      throw new Error(`Wallet derivation result is uncertain and requires reconciliation at the same journaled diversifier: ${errorCode(error)}`);
    }
    await input.hooks?.afterDerivation?.();
    await input.store.recordDerivedAddress(input.orderId, input.authorizationId, input.operatorId, derived.address, derived.diversifierIndex, now);
    await input.hooks?.afterDerivedRecord?.();
    operation = await input.store.addressAllocationOperation(input.orderId, input.authorizationId, input.operatorId);
  }

  try {
    const candidate = await validateUnusedWalletBAddress(operation.address!, { rpc, allocationId: operation.allocationId, now });
    const allocationId = await input.store.reserveDerivedAddress(input.orderId, input.operatorId, input.authorizationId, candidate, now);
    await input.hooks?.afterReservation?.();
    return allocationId;
  } catch (error) {
    const latest = await input.store.addressAllocationOperation(input.orderId, input.authorizationId, input.operatorId);
    if (latest.phase !== 'RESERVED') await input.store.markAddressRecoveryRequired(input.orderId, input.authorizationId, input.operatorId, errorCode(error), now);
    throw error;
  }
}
