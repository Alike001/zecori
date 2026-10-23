import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_REFERENCE_TRANSACTION, ERC20_TRANSFER_TOPIC, verifyBaseSepoliaTransaction } from './base-sepolia-verifier.ts';
import { BASE_USDC } from '../src/lib/order-coordinator.ts';
import type { RpcCall } from './rpc-client.ts';

const txid = `0x${'a'.repeat(64)}`;
const recipient = `0x${'b'.repeat(40)}`;
const blockHash = `0x${'c'.repeat(64)}`;
const addressTopic = `0x${'0'.repeat(24)}${recipient.slice(2)}`;
const amountData = `0x${(1_000_000n).toString(16).padStart(64, '0')}`;

function rpc(overrides: { receipt?: unknown; block?: unknown; chainId?: string; latest?: string } = {}): RpcCall {
  const receipt = 'receipt' in overrides ? overrides.receipt : {
    status: '0x1', blockHash, blockNumber: '0x64', transactionHash: txid,
    logs: [
      { address: `0x${'d'.repeat(40)}`, topics: [ERC20_TRANSFER_TOPIC, addressTopic, addressTopic], data: amountData, transactionHash: txid, blockHash },
      { address: BASE_USDC, topics: [ERC20_TRANSFER_TOPIC, addressTopic, addressTopic], data: amountData, transactionHash: txid, blockHash, removed: false },
    ],
  };
  const values: Record<string, unknown> = {
    eth_chainId: overrides.chainId ?? '0x14a34',
    eth_getTransactionReceipt: receipt,
    eth_blockNumber: overrides.latest ?? '0x70',
    eth_getBlockByNumber: 'block' in overrides ? overrides.block : { hash: blockHash, number: '0x64', transactions: [txid] },
  };
  return async <T>(method: string) => values[method] as T;
}

test('verifies one exact official USDC Transfer and ignores unrelated logs', async () => {
  const result = await verifyBaseSepoliaTransaction({ orderId: 'order-1', transactionId: txid, recipient, amountAtomic: '1000000' }, { rpc: rpc() });
  assert.equal(result.chainId, 84532);
  assert.equal(result.recipient, recipient);
  assert.equal(result.amountAtomic, '1000000');
});

test('rejects missing, failed, non-canonical and mismatched transfer evidence', async () => {
  const request = { orderId: 'order-1', transactionId: txid, recipient, amountAtomic: '1000000' };
  await assert.rejects(verifyBaseSepoliaTransaction(request, { rpc: rpc({ receipt: null }) }), /missing/);
  await assert.rejects(verifyBaseSepoliaTransaction(request, { rpc: rpc({ chainId: '0x1' }) }), /not Base Sepolia/);
  await assert.rejects(verifyBaseSepoliaTransaction(request, { rpc: rpc({ receipt: { status: '0x0', blockHash, blockNumber: '0x64', transactionHash: txid, logs: [] } }) }), /did not succeed/);
  await assert.rejects(verifyBaseSepoliaTransaction(request, { rpc: rpc({ block: { hash: `0x${'e'.repeat(64)}`, transactions: [txid] } }) }), /not canonical/);
  await assert.rejects(verifyBaseSepoliaTransaction({ ...request, minimumConfirmations: 20 }, { rpc: rpc() }), /Insufficient confirmations/);
  await assert.rejects(verifyBaseSepoliaTransaction({ ...request, recipient: `0x${'f'.repeat(40)}` }, { rpc: rpc() }), /Exactly one/);
  await assert.rejects(verifyBaseSepoliaTransaction({ ...request, amountAtomic: '999999' }, { rpc: rpc() }), /Exactly one/);
  const wrongContractReceipt = {
    status: '0x1', blockHash, blockNumber: '0x64', transactionHash: txid,
    logs: [{ address: `0x${'d'.repeat(40)}`, topics: [ERC20_TRANSFER_TOPIC, addressTopic, addressTopic], data: amountData, transactionHash: txid, blockHash }],
  };
  await assert.rejects(verifyBaseSepoliaTransaction(request, { rpc: rpc({ receipt: wrongContractReceipt }) }), /Exactly one/);
});

test('rejects duplicate matching outputs and the historical reference in production mode', async () => {
  const duplicateReceipt = {
    status: '0x1', blockHash, blockNumber: '0x64', transactionHash: txid,
    logs: Array.from({ length: 2 }, () => ({ address: BASE_USDC, topics: [ERC20_TRANSFER_TOPIC, addressTopic, addressTopic], data: amountData, transactionHash: txid, blockHash })),
  };
  await assert.rejects(verifyBaseSepoliaTransaction({ orderId: 'order-1', transactionId: txid, recipient, amountAtomic: '1000000' }, { rpc: rpc({ receipt: duplicateReceipt }) }), /Exactly one/);
  await assert.rejects(verifyBaseSepoliaTransaction({ orderId: 'order-1', transactionId: BASE_REFERENCE_TRANSACTION, recipient, amountAtomic: '1000000' }, { rpc: rpc() }), /Historical reference/);
});

test('read-only live reference transaction integration', { skip: process.env.BASE_RPC_LIVE !== '1' }, async () => {
  const result = await verifyBaseSepoliaTransaction({
    orderId: 'reference-test-only', transactionId: BASE_REFERENCE_TRANSACTION,
    recipient: '0xac3672b0f6134119d61b7222752b671cc392173f', amountAtomic: '1000000', minimumConfirmations: 3,
  }, { allowHistoricalReference: true });
  assert.equal(result.amountAtomic, '1000000');
});
