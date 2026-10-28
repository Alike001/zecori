import { createHash } from 'node:crypto';
import { exactJsonDecimal, type RpcCall } from './rpc-client.ts';
import {
  assertWalletASigningPacket, PostgresSourcePaymentOperationStore, type SourcePaymentOperation, type WalletASigningPacket,
} from './zcash-signing-packet.ts';
import { SOURCE_FEE_RESERVE_ZATOSHIS, SOURCE_PAYMENT_ZATOSHIS, type SourceWalletSubmissionHealth } from './zcash-source-wallet.ts';

type ZecdOperationStatus = {
  operationid?: unknown; status?: unknown; method?: unknown; params?: unknown;
  result?: { txid?: unknown }; error?: { code?: unknown; message?: unknown };
};

export type SourcePaymentOperationStore = Pick<PostgresSourcePaymentOperationStore,
  'load' | 'beginSubmission' | 'recordOpid' | 'recordRecoveredOpid' | 'markSubmissionAmbiguous' | 'requireRecovery' | 'recordTxid' | 'recordRecoveredTxid'>;

export function sourcePaymentReview(packet: WalletASigningPacket) {
  assertWalletASigningPacket(packet, undefined, Date.parse(packet.expiresAt) - 1);
  return Object.freeze({
    orderId: packet.orderId, allocationId: packet.allocationId, packetDigest: packet.packetDigest,
    receiverFingerprint: createHash('sha256').update(packet.receiver).digest('hex'), sourceAmountZatoshis: packet.sourceAmountZatoshis,
    minimumConfirmations: packet.minimumConfirmations, memo: packet.memo, feeMode: packet.feeMode,
    feeReserveZatoshis: packet.feeReserveZatoshis, privacyPolicy: packet.privacyPolicy, paymentDeadline: packet.expiresAt,
    broadcastPerformed: false,
  });
}

export function sourcePaymentOperationSummary(operation: SourcePaymentOperation) {
  return Object.freeze({
    operationId: operation.operationId, orderId: operation.orderId, state: operation.state,
    packetDigest: operation.packet.packetDigest, hasZecdOperationId: Boolean(operation.opid), hasTransactionId: Boolean(operation.txid),
    recoveryReason: operation.recoveryReason, submissionStartedAt: operation.submissionStartedAt,
    paymentDeadline: operation.packet.expiresAt, broadcastRetryAllowed: false,
  });
}

function assertSubmissionWallet(packet: WalletASigningPacket, wallet: SourceWalletSubmissionHealth, now: number): void {
  if (wallet.locked || wallet.unlockedUntil <= Math.floor(now / 1_000) || wallet.walletName !== packet.walletName || !wallet.walletOwned
    || !wallet.synchronized || !wallet.historyComplete || wallet.minimumConfirmations !== 10) throw new Error('Wallet A is not freshly unlocked, synchronized, owned, and bound to the prepared packet');
  if (BigInt(wallet.poolZatoshis.orchard ?? '0') !== 0n) throw new Error('Fresh Wallet A eligibility includes legacy Orchard value');
  if (BigInt(wallet.poolZatoshis.ironwood ?? '0') < SOURCE_PAYMENT_ZATOSHIS + SOURCE_FEE_RESERVE_ZATOSHIS || !wallet.fullPrivacyCompatible) {
    throw new Error('Fresh Wallet A Ironwood value is insufficient for the exact payment and reviewed fee reserve');
  }
}

export async function submitWalletASourcePayment(input: {
  store: SourcePaymentOperationStore; operationId: string; packetDigest: string; wallet: SourceWalletSubmissionHealth; rpc: RpcCall; now?: number;
}): Promise<{ operationId: string; state: 'OPID_RECORDED'; broadcastAttempted: true }> {
  const now = input.now ?? Date.now(); const operation = await input.store.load(input.operationId);
  if (operation.state !== 'PREPARED' || operation.packet.packetDigest !== input.packetDigest) throw new Error('Source payment is not the exact prepared one-time packet');
  assertWalletASigningPacket(operation.packet, undefined, now); assertSubmissionWallet(operation.packet, input.wallet, now);
  await input.store.beginSubmission(input.operationId, input.packetDigest, now);
  try {
    const params = ['ANY_ORCHARD', [{ address: operation.packet.receiver, amount: exactJsonDecimal('0.01000000') }], 10, null, 'FullPrivacy'];
    const opid = await input.rpc<string>('z_sendmany', params);
    await input.store.recordOpid(input.operationId, opid, now);
    return { operationId: input.operationId, state: 'OPID_RECORDED', broadcastAttempted: true };
  } catch {
    await input.store.markSubmissionAmbiguous(input.operationId, 'zecd-submit-response-ambiguous', now).catch(() => undefined);
    throw new Error('Wallet A submission result is ambiguous; never call z_sendmany again for this operation. Run recover-source-payment.');
  }
}

function exactAmount(value: unknown): boolean { return value === 0.01 || value === '0.01' || value === '0.01000000'; }
function statusMatchesPacket(status: ZecdOperationStatus, packet: WalletASigningPacket): boolean {
  if (status.method !== 'z_sendmany') return false;
  const params = status.params;
  if (Array.isArray(params)) {
    const [from, outputs, minconf, fee, policy] = params;
    return from === 'ANY_ORCHARD' && Array.isArray(outputs) && outputs.length === 1
      && (outputs[0] as { address?: unknown }).address === packet.receiver && exactAmount((outputs[0] as { amount?: unknown }).amount)
      && !Object.hasOwn(outputs[0] as object, 'memo') && minconf === 10 && fee === null && policy === 'FullPrivacy';
  }
  if (!params || typeof params !== 'object') return false;
  const value = params as Record<string, unknown>; const outputs = value.amounts ?? value.recipients;
  return (value.fromaddress ?? value.from_address) === 'ANY_ORCHARD' && Array.isArray(outputs) && outputs.length === 1
    && (outputs[0] as { address?: unknown }).address === packet.receiver && exactAmount((outputs[0] as { amount?: unknown }).amount)
    && !Object.hasOwn(outputs[0] as object, 'memo') && (value.minconf ?? value.min_conf) === 10 && value.fee === null
    && (value.privacyPolicy ?? value.privacy_policy) === 'FullPrivacy';
}

async function operationStatuses(rpc: RpcCall, opid?: string): Promise<ZecdOperationStatus[]> {
  const value = await rpc<unknown>('z_getoperationstatus', opid ? [[opid]] : []);
  if (!Array.isArray(value)) throw new Error('zecd operation status response is invalid');
  return value as ZecdOperationStatus[];
}

export async function recoverWalletASourcePayment(input: {
  store: SourcePaymentOperationStore; operationId: string; rpc: RpcCall; recoveredOpid?: string; recoveredTxid?: string; now?: number;
}): Promise<{ state: string; terminal: boolean; walletRelocked: boolean; transactionId?: string }> {
  const now = input.now ?? Date.now(); let operation = await input.store.load(input.operationId);
  if (operation.state === 'TXID_RECORDED') { await input.rpc('walletlock'); return { state: operation.state, terminal: true, walletRelocked: true, transactionId: operation.txid }; }
  if (operation.state === 'PREPARED') throw new Error('Prepared source payment has never crossed the broadcast boundary');
  if (operation.state === 'SUBMISSION_STARTED') {
    await input.store.markSubmissionAmbiguous(input.operationId, 'process-interrupted-after-submission-start', now); operation = await input.store.load(input.operationId);
  }
  if (operation.state === 'SUBMISSION_AMBIGUOUS') {
    const statuses = await operationStatuses(input.rpc, input.recoveredOpid);
    const matches = statuses.filter(status => statusMatchesPacket(status, operation.packet));
    if (matches.length !== 1 || typeof matches[0].operationid !== 'string' || (input.recoveredOpid && matches[0].operationid !== input.recoveredOpid)) {
      await input.store.requireRecovery(input.operationId, matches.length ? 'ambiguous-multiple-exact-zecd-operations' : 'exact-zecd-operation-not-found', now);
      throw new Error('Exact zecd operation could not be uniquely recovered; the payment remains recovery-required and must not be repeated');
    }
    await input.store.recordRecoveredOpid(input.operationId, matches[0].operationid, now); operation = await input.store.load(input.operationId);
  }
  if (operation.state === 'RECOVERY_REQUIRED') {
    if (!input.recoveredTxid) throw new Error('Source payment requires manual recovery; automatic resubmission is forbidden');
    await input.store.recordRecoveredTxid(input.operationId, input.recoveredTxid, now); await input.rpc('walletlock');
    return { state: 'TXID_RECORDED', terminal: true, walletRelocked: true, transactionId: input.recoveredTxid.toLowerCase() };
  }
  if (operation.state !== 'OPID_RECORDED' || !operation.opid) throw new Error('Source payment operation has no recoverable zecd operation ID');
  const statuses = await operationStatuses(input.rpc, operation.opid); const status = statuses.find(item => item.operationid === operation.opid);
  if (!status) { await input.store.requireRecovery(input.operationId, 'zecd-operation-status-missing', now); throw new Error('zecd no longer reports the recorded operation; manual recovery is required'); }
  if (status.method !== undefined && status.method !== 'z_sendmany') { await input.store.requireRecovery(input.operationId, 'zecd-operation-method-mismatch', now); throw new Error('Recorded zecd operation method does not match the source payment'); }
  if (status.params !== undefined && !statusMatchesPacket({ ...status, method: 'z_sendmany' }, operation.packet)) { await input.store.requireRecovery(input.operationId, 'zecd-operation-params-mismatch', now); throw new Error('Recorded zecd operation parameters do not match the immutable packet'); }
  if (status.status === 'queued' || status.status === 'executing') return { state: String(status.status), terminal: false, walletRelocked: false };
  if (status.status === 'success' && typeof status.result?.txid === 'string' && /^[0-9a-f]{64}$/i.test(status.result.txid)) {
    await input.store.recordTxid(input.operationId, status.result.txid, now); await input.rpc('walletlock');
    return { state: 'TXID_RECORDED', terminal: true, walletRelocked: true, transactionId: status.result.txid.toLowerCase() };
  }
  await input.store.requireRecovery(input.operationId, `zecd-operation-${String(status.status ?? 'invalid')}`, now); await input.rpc('walletlock');
  return { state: 'RECOVERY_REQUIRED', terminal: true, walletRelocked: true };
}
