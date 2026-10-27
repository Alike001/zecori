#!/usr/bin/env node
import { createPostgresPool } from '../server/postgres.ts';
import { loadEncryptionKeyring } from '../server/data-encryption.ts';
import { PostgresSettlementStore } from '../server/postgres-settlement-store.ts';
import { OperatorControlStore, inspectOperatorKey } from '../server/operator-control.ts';
import { executePostgresAddressAllocation } from '../server/postgres-address-allocation.ts';
import { verifyZcashTransaction } from '../server/zcash-verifier.ts';
import { verifyBaseSepoliaTransaction } from '../server/base-sepolia-verifier.ts';
import { PrivateVerificationRelay } from '../server/private-verification-relay.ts';
import { loadRelayPrivateKey, loadRelayPublicKey, requirePrivateRelayTransport } from '../server/relay-keys.ts';
import { contractWalletPolicy, createBaseSepoliaWalletControlVerifier } from '../server/wallet-control.ts';
import { loadOperatorConfig } from '../server/operator-config.ts';

function parse(values: string[]): { command: string; options: Record<string, string> } {
  if (values[0] === '--') values.shift(); const [command = 'help', ...rest] = values; const options: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 2) { const key = rest[index]; const value = rest[index + 1]; if (!key?.startsWith('--') || value === undefined) throw new Error(`Expected --name value, received ${key ?? 'nothing'}`); options[key.slice(2)] = value; }
  return { command, options };
}
function required(value: string | undefined, label: string): string { if (!value?.trim()) throw new Error(`${label} is required`); return value.trim(); }
function confirm(actual: string | undefined, expected: string): void { if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Mutation commands require an interactive operator terminal'); if (actual !== expected) throw new Error(`Explicit confirmation must exactly equal: ${expected}`); }
function print(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function masked(value: string): string { return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }

const { command, options } = parse(process.argv.slice(2));
const readOnly = ['help', 'status', 'pending-requests', 'orders', 'verify-receipt'].includes(command);
if (!readOnly) confirm(options.confirm, `EXECUTE ${command.toUpperCase()}`);
const operatorId = options.operator ?? process.env.ZECATHON_OPERATOR_ID;
const pool = command === 'help' ? undefined : createPostgresPool();

try {
  if (command === 'help') {
    print({
      commands: ['status', 'pending-requests', 'accept-request', 'orders', 'authorize-allocation', 'allocate-address', 'reconcile-allocation', 'cancel-allocation', 'publish-instructions', 'relay-source-detect', 'relay-source-confirm', 'relay-apply', 'observe-source', 'confirm-source', 'queue-payout', 'authorize-payout', 'approve-payout', 'record-payout', 'verify-payout', 'verify-receipt', 'expire-order', 'mark-unresolved'],
      confirmation: 'Every mutation requires --confirm "EXECUTE COMMAND-NAME" in an interactive terminal.',
      safety: 'allocate-address is the only wallet-mutating command and requires a scoped authorization plus a durable PostgreSQL journal. No command unlocks a wallet, signs or broadcasts a transaction, executes a payout, or moves funds.',
    });
  } else {
    const encryption = await loadEncryptionKeyring(); const walletVerifier = createBaseSepoliaWalletControlVerifier(process.env.BASE_SEPOLIA_RPC_URL, contractWalletPolicy(process.env.ZECATHON_ERC1271_ENABLED)); const store = new PostgresSettlementStore(pool!, encryption, walletVerifier); const controls = new OperatorControlStore();
    switch (command) {
      case 'status': print({ postgres: await store.health().then(() => ({ ready: true }), error => ({ ready: false, reason: error instanceof Error ? error.message : 'unavailable' })), encryption: { ready: true, activeVersion: encryption.activeVersion }, operatorAuthorizationKey: await inspectOperatorKey(), legacyJson: 'preserved-read-only-not-used-by-production-commands' }); break;
      case 'pending-requests': print({ requests: await store.pendingRequests() }); break;
      case 'accept-request': {
        const operator = required(operatorId, 'Operator ID'); const requestId = required(options.request, 'Request ID');
        if (required(options.terms, 'Exact terms confirmation') !== '0.01 TAZ -> 1 test USDC') throw new Error('Exact terms confirmation must equal: 0.01 TAZ -> 1 test USDC');
        const result = await store.acceptRequest(requestId, operator, (binding, id) => controls.signOrderManifest(binding, id));
        print({ stage: 'REQUEST_ACCEPTED', orderId: result.orderId, manifestSigned: true, signatureDisplayed: false }); break;
      }
      case 'orders': { const snapshot = await store.operatorSnapshot(); print({ ...snapshot, orders: snapshot.orders.map(item => ({ ...item, id: masked(item.id) })), pendingAllocationOperations: snapshot.pendingAllocationOperations.map(item => ({ ...item, allocationId: masked(item.allocationId), orderId: masked(item.orderId), authorizationId: masked(item.authorizationId) })) }); break; }
      case 'authorize-allocation': { const id = await store.issueAuthorization(required(options.order, 'Order ID'), 'ADDRESS_ALLOCATION', required(operatorId, 'Operator ID'), (domain, value) => controls.signOperatorPayload(domain, value)); print({ authorizationId: id, action: 'ADDRESS_ALLOCATION', executionPerformed: false }); break; }
      case 'allocate-address':
      case 'reconcile-allocation': {
        const orderId = required(options.order, 'Order ID'); const authorizationId = required(options.authorization, 'Authorization ID');
        const allocationId = await executePostgresAddressAllocation({
          store, orderId, authorizationId, operatorId: required(operatorId, 'Operator ID'),
          verifyAuthorization: (domain, value, signature) => controls.verifyOperatorPayload(domain, value, signature),
          mode: command === 'reconcile-allocation' ? 'RECONCILE' : 'EXECUTE',
        });
        print({ stage: 'ALLOCATION_RESERVED', orderId, allocationId, receiverDisplayed: false, sameJournaledDiversifier: true }); break;
      }
      case 'cancel-allocation': {
        await store.cancelAddressAllocation(required(options.order, 'Order ID'), required(options.authorization, 'Authorization ID'), required(operatorId, 'Operator ID'), (domain, value, signature) => controls.verifyOperatorPayload(domain, value, signature), required(options.reason, 'Cancellation reason'));
        print({ stage: 'ALLOCATION_CANCELLED_BEFORE_RPC', receiverDerived: false }); break;
      }
      case 'publish-instructions': await store.publishPaymentInstructions(required(options.order, 'Order ID'), required(operatorId, 'Operator ID')); print({ stage: 'PAYMENT_INSTRUCTIONS_PUBLISHED' }); break;
      case 'relay-source-detect':
      case 'relay-source-confirm': {
        requirePrivateRelayTransport();
        const verifierId = required(options.verifier ?? process.env.ZECATHON_RELAY_VERIFIER_ID, 'Verifier ID');
        const [coordinatorKey, verifierKey, relayEncryption] = await Promise.all([loadRelayPrivateKey(process.env.ZECATHON_RELAY_COORDINATOR_PRIVATE_KEY_FILE), loadRelayPublicKey(process.env.ZECATHON_RELAY_VERIFIER_PUBLIC_KEY_FILE), loadEncryptionKeyring(process.env.ZECATHON_RELAY_ENCRYPTION_KEY_FILE)]);
        const relay = new PrivateVerificationRelay(pool!, relayEncryption, coordinatorKey, new Map([[verifierId, verifierKey]]), encryption);
        const jobId = await relay.createSourceJob({ orderId: required(options.order, 'Order ID'), transactionId: required(options.tx, 'Source transaction ID'), phase: command === 'relay-source-detect' ? 'SOURCE_DETECTION' : 'SOURCE_CONFIRMATION', verifierId });
        print({ stage: 'PRIVATE_VERIFICATION_QUEUED', jobId, verifierId, evidenceDisplayed: false }); break;
      }
      case 'relay-apply': {
        requirePrivateRelayTransport(); const jobId = required(options.job, 'Relay job ID'); const verifierId = required(options.verifier ?? process.env.ZECATHON_RELAY_VERIFIER_ID, 'Verifier ID');
        const [relayEncryption, coordinatorPublicKey, verifierPublicKey] = await Promise.all([loadEncryptionKeyring(process.env.ZECATHON_RELAY_ENCRYPTION_KEY_FILE), loadRelayPublicKey(process.env.ZECATHON_RELAY_COORDINATOR_PUBLIC_KEY_FILE), loadRelayPublicKey(process.env.ZECATHON_RELAY_VERIFIER_PUBLIC_KEY_FILE)]);
        const relay = new PrivateVerificationRelay(pool!, relayEncryption, undefined, new Map([[verifierId, verifierPublicKey]])); const envelope = await relay.verifiedMessage(jobId, coordinatorPublicKey);
        if (envelope.payload.outcome === 'VERIFIED') await store.applyRelaySourceEvidence(jobId, envelope); else await store.applyRelayUnresolved(jobId, envelope);
        print({ stage: envelope.payload.outcome === 'VERIFIED' ? 'PRIVATE_VERIFICATION_APPLIED' : 'ORDER_UNRESOLVED', jobId, evidenceDisplayed: false }); break;
      }
      case 'observe-source': await store.observeSource(required(options.order, 'Order ID'), required(options.tx, 'Source transaction ID'), verifyZcashTransaction); print({ stage: 'SOURCE_EVIDENCE_RECORDED' }); break;
      case 'confirm-source': await store.confirmSource(required(options.order, 'Order ID'), verifyZcashTransaction); print({ stage: 'SOURCE_CONFIRMED' }); break;
      case 'queue-payout': await store.queuePayout(required(options.order, 'Order ID'), required(operatorId, 'Operator ID')); print({ stage: 'PAYOUT_AWAITING_APPROVAL', payoutPerformed: false }); break;
      case 'authorize-payout': { const id = await store.issueAuthorization(required(options.order, 'Order ID'), 'PAYOUT', required(operatorId, 'Operator ID'), (domain, value) => controls.signOperatorPayload(domain, value)); print({ authorizationId: id, action: 'PAYOUT', payoutPerformed: false }); break; }
      case 'approve-payout': await store.approvePayout(required(options.order, 'Order ID'), required(operatorId, 'Operator ID'), required(options.authorization, 'Authorization ID'), (domain, value, signature) => controls.verifyOperatorPayload(domain, value, signature)); print({ stage: 'PAYOUT_APPROVED', payoutPerformed: false }); break;
      case 'record-payout': await store.recordPayout(required(options.order, 'Order ID'), required(operatorId, 'Operator ID'), required(options.tx, 'Destination transaction ID')); print({ stage: 'PAYOUT_REFERENCE_RECORDED', payoutPerformed: false }); break;
      case 'verify-payout': {
        const { lpSender } = await loadOperatorConfig();
        const receiptId = await store.verifyPayout(required(options.order, 'Order ID'), value => controls.signReceipt(value), request => verifyBaseSepoliaTransaction({ ...request, expectedSender: lpSender }));
        print({ stage: 'VERIFIED_RECEIPT_CREATED', receiptId, payoutSenderBound: true }); break;
      }
      case 'verify-receipt': { const result = await store.verifyReceiptAuthenticity(required(options.receipt, 'Receipt ID'), (value, signature) => controls.verifyReceipt(value, signature)); print({ ...result, orderId: masked(result.orderId) }); break; }
      case 'expire-order': await store.expire(required(options.order, 'Order ID')); print({ stage: 'ORDER_EXPIRED' }); break;
      case 'mark-unresolved': await store.setUnresolved(required(options.order, 'Order ID'), required(operatorId, 'Operator ID'), required(options.reason, 'Resolution reason')); print({ stage: 'ORDER_UNRESOLVED' }); break;
      default: throw new Error(`Unknown operator command: ${command}`);
    }
  }
} catch (error) { process.stderr.write(`Operator command refused: ${error instanceof Error ? error.message : 'unknown error'}\n`); process.exitCode = 1; }
finally { await pool?.end(); }
