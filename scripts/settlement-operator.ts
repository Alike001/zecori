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
import { PostgresBasePayoutPacketStore } from '../server/base-payout-signing-packet.ts';
import { PostgresMetaMaskPayoutStore, rehearseMetaMaskPayout, type MetaMaskProvider } from '../server/metamask-payout.ts';
import { checkSourceWalletA, checkSourceWalletAForSubmission, sourceWalletARpc } from '../server/zcash-source-wallet.ts';
import { PostgresSourcePaymentOperationStore, prepareWalletASigningPacket } from '../server/zcash-signing-packet.ts';
import { recoverWalletASourcePayment, sourcePaymentOperationSummary, sourcePaymentReview, submitWalletASourcePayment } from '../server/zcash-source-payment.ts';

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
const readOnly = ['help', 'status', 'pending-requests', 'orders', 'preview-source-payment', 'source-payment-status', 'verify-receipt'].includes(command);
if (!readOnly) confirm(options.confirm, `EXECUTE ${command.toUpperCase()}`);
const operatorId = options.operator ?? process.env.ZECATHON_OPERATOR_ID;
const pool = command === 'help' ? undefined : createPostgresPool();

try {
  if (command === 'help') {
    print({
      commands: ['status', 'pending-requests', 'accept-request', 'orders', 'authorize-allocation', 'allocate-address', 'reconcile-allocation', 'cancel-allocation', 'publish-instructions', 'preview-source-payment', 'prepare-source-payment', 'source-payment-status', 'submit-source-payment', 'recover-source-payment', 'relay-source-detect', 'relay-source-confirm', 'relay-apply', 'observe-source', 'confirm-source', 'queue-payout', 'authorize-payout', 'approve-payout', 'rehearse-metamask-payout', 'record-payout', 'verify-payout', 'verify-receipt', 'expire-order', 'mark-unresolved'],
      confirmation: 'Every mutation requires --confirm "EXECUTE COMMAND-NAME" in an interactive terminal.',
      safety: 'Wallet A submit is the only payment-broadcast command. It requires a prepared encrypted packet, an already-unlocked operator wallet, a durable one-attempt transition, generic confirmation, and a second exact broadcast confirmation. It never unlocks or prints wallet secrets. Ambiguous results are recovery-only and cannot be blindly repeated.',
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
      case 'preview-source-payment': {
        const order = await store.sourcePaymentOrder(required(options.order, 'Order ID')); const wallet = await checkSourceWalletA();
        const packet = prepareWalletASigningPacket(order, wallet); print({ stage: 'WALLET_A_SOURCE_PAYMENT_PREVIEW', ...sourcePaymentReview(packet) }); break;
      }
      case 'prepare-source-payment': {
        const order = await store.sourcePaymentOrder(required(options.order, 'Order ID')); const wallet = await checkSourceWalletA();
        const packet = prepareWalletASigningPacket(order, wallet); const operationId = await new PostgresSourcePaymentOperationStore(pool!, encryption).prepare(packet);
        print({ stage: 'WALLET_A_SOURCE_PAYMENT_PREPARED', operationId, ...sourcePaymentReview(packet) }); break;
      }
      case 'source-payment-status': {
        const operation = await new PostgresSourcePaymentOperationStore(pool!, encryption).load(required(options.operation, 'Source payment operation ID'));
        print({ stage: 'WALLET_A_SOURCE_PAYMENT_STATUS', ...sourcePaymentOperationSummary(operation) }); break;
      }
      case 'submit-source-payment': {
        const operationId = required(options.operation, 'Source payment operation ID'); const packetDigest = required(options['packet-digest'], 'Source packet digest');
        const expectedBroadcast = `BROADCAST WALLET-A ${operationId} 1000000 ZAT NO-MEMO ZIP317`;
        if (required(options['broadcast-confirm'], 'Separate Wallet A broadcast confirmation') !== expectedBroadcast) throw new Error(`Separate broadcast confirmation must exactly equal: ${expectedBroadcast}`);
        const operationStore = new PostgresSourcePaymentOperationStore(pool!, encryption); const operation = await operationStore.load(operationId);
        if (operation.packet.packetDigest !== packetDigest) throw new Error('Reviewed packet digest does not match the prepared source payment');
        const rpc = await sourceWalletARpc(); const wallet = await checkSourceWalletAForSubmission(rpc, operation.packet.walletName);
        const result = await submitWalletASourcePayment({ store: operationStore, operationId, packetDigest, wallet, rpc });
        print({ stage: 'WALLET_A_SUBMISSION_STARTED', operationId: result.operationId, zecdOperationIdRecorded: true, broadcastAttempted: true, repeatAllowed: false }); break;
      }
      case 'recover-source-payment': {
        const operationStore = new PostgresSourcePaymentOperationStore(pool!, encryption); const rpc = await sourceWalletARpc();
        const result = await recoverWalletASourcePayment({ store: operationStore, operationId: required(options.operation, 'Source payment operation ID'), rpc, ...(options.opid ? { recoveredOpid: options.opid } : {}), ...(options.tx ? { recoveredTxid: options.tx } : {}) });
        print({ stage: 'WALLET_A_SOURCE_PAYMENT_RECOVERY', ...result, transactionIdDisplayed: Boolean(result.transactionId), privacy: 'operator-terminal-only; do not publish raw logs', repeatAllowed: false }); break;
      }
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
      case 'rehearse-metamask-payout': {
        const packetStore=new PostgresBasePayoutPacketStore(pool!);const packet=await packetStore.load(required(options.packet,'Payout packet ID'));
        const observed:Record<string,unknown>={eth_chainId:required(options['chain-id'],'Observed chain ID'),eth_accounts:[required(options.account,'Observed MetaMask account')],eth_getBlockByNumber:{baseFeePerGas:required(options['base-fee'],'Observed base fee')},eth_estimateGas:required(options['gas-estimate'],'Observed gas estimate')};
        const provider:MetaMaskProvider={async request(input){if(input.method==='eth_getTransactionCount')return input.params?.[1]==='latest'?required(options['latest-nonce'],'Observed latest nonce'):required(options['pending-nonce'],'Observed pending nonce');return observed[input.method];}};
        const rehearsal=await rehearseMetaMaskPayout(packet,provider);await new PostgresMetaMaskPayoutStore(pool!).recordRehearsal(rehearsal);
        print({stage:'METAMASK_PAYOUT_REHEARSED',packetId:packet.packetId,requestDigest:rehearsal.requestDigest,transaction:rehearsal.transaction,broadcastPerformed:false,semantics:'eth_sendTransaction would prompt, sign, and broadcast; success returns a transaction hash, never signed raw bytes'});break;
      }
      case 'record-payout': await store.recordPayout(required(options.order, 'Order ID'), required(operatorId, 'Operator ID'), required(options.tx, 'Destination transaction ID')); print({ stage: 'PAYOUT_REFERENCE_RECORDED', payoutPerformed: false }); break;
      case 'verify-payout': {
        const { lpSender } = await loadOperatorConfig();
        const orderId=required(options.order,'Order ID');const packetStore=new PostgresBasePayoutPacketStore(pool!);const packet=await packetStore.loadByOrder(orderId);const submittedHash=await packetStore.transactionHash(orderId);
        const receiptId = await store.verifyPayout(orderId, value => controls.signReceipt(value), request => {if(request.transactionId.toLowerCase()!==submittedHash.toLowerCase())throw new Error('Recorded order payout hash does not match the one-time packet submission');return verifyBaseSepoliaTransaction({ ...request, expectedSender: lpSender, expectedTransaction:{nonce:packet.nonce,calldata:packet.calldata,gasLimit:packet.gasLimit,maxFeePerGas:packet.maxFeePerGas,maxPriorityFeePerGas:packet.maxPriorityFeePerGas} });});
        await packetStore.markConfirmed(packet.packetId,submittedHash);
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
