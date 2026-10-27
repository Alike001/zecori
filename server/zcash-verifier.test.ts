import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkWatchOnlyVerifierHealth, verifierZecdDataDir, verifyZcashTransaction, ZECD_WALLET_B_DATA } from './zcash-verifier.ts';
import type { RpcCall } from './rpc-client.ts';

const txid = 'a'.repeat(64);
const receiver = 'utest1completeshieldedreceiver123456789';
const blockHash = 'b'.repeat(64);
const chainTime = Math.floor(Date.now() / 1000);

function rpc(overrides: Record<string, unknown> = {}): RpcCall {
  const values: Record<string, unknown> = {
    getblockchaininfo: { chain: 'test', blocks: 500, headers: 500, initialblockdownload: false, bestblockhash: 'c'.repeat(64), time: chainTime, warnings: '' },
    getwalletinfo: { scanning: false, enhanced_through: 500, txcount: 1, private_keys_enabled: false },
    getaddressinfo: { address: receiver, ismine: true, isvalid_orchard: true, receiver_types: ['orchard'], receivers_consistent: true, diversifier_index: '42' },
    gettransaction: { txid, confirmations: 12, blockhash: blockHash, blockheight: 489, blocktime: 1_900_000_000, details: [] },
    getblockhash: blockHash,
    z_listtransactions: [{ txid, status: 'mined', confirmations: 12, pool: 'ironwood', category: 'receive', amountZat: 1_000_000, address: receiver, outgoing: false, change: false, blockhash: blockHash, blockheight: 489, diversifier_index: '42', outindex: 0 }],
    ...overrides,
  };
  return async <T>(method: string) => values[method] as T;
}

const request = { orderId: 'order-1', transactionId: txid, receiver, amountZatoshis: '1000000', expectedDiversifierIndex: '42', requiredPool: 'ironwood' as const };

test('private verifier data directory override must be an absolute path', () => {
  assert.equal(verifierZecdDataDir({}), ZECD_WALLET_B_DATA);
  assert.equal(verifierZecdDataDir({ ZECATHON_VERIFIER_ZECD_DATA_DIR: '/var/lib/zecori-zecd' }), '/var/lib/zecori-zecd');
  assert.throws(() => verifierZecdDataDir({ ZECATHON_VERIFIER_ZECD_DATA_DIR: '../wallet' }), /absolute private path/);
});

test('verifies one exact incoming owned Ironwood output in zatoshis', async () => {
  const result = await verifyZcashTransaction(request, { rpc: rpc() });
  assert.equal(result.network, 'zcash-testnet');
  assert.equal(result.amount, '0.01');
});

test('restart health accepts only a synchronized seedless watch-only verifier', async () => {
  const health = await checkWatchOnlyVerifierHealth(rpc({
    getwalletinfo: { walletname: 'default', scanning: false, enhanced_through: 500, txcount: 1, private_keys_enabled: false },
  }));
  assert.equal(health.custody, 'watch-only');
  assert.equal(health.historyComplete, true);
  assert.equal(health.bestBlockHash, 'c'.repeat(64));

  await assert.rejects(checkWatchOnlyVerifierHealth(rpc({
    getwalletinfo: { walletname: 'default', scanning: false, enhanced_through: 500, txcount: 1, private_keys_enabled: true, unlocked_until: 0 },
  })), /seedless watch-only/);
  await assert.rejects(checkWatchOnlyVerifierHealth(rpc({
    getwalletinfo: { walletname: 'other', scanning: false, enhanced_through: 500, txcount: 1, private_keys_enabled: false },
  })), /identity/);
  await assert.rejects(checkWatchOnlyVerifierHealth(rpc({
    getwalletinfo: { walletname: 'default', scanning: { progress: 1, pending_enhancements: 2 }, enhanced_through: 500, txcount: 1, private_keys_enabled: false },
  })), /incomplete/);
});

test('accepts watch-only custody and rejects wrong network, incomplete sync, unlocked or ambiguous custody, and non-owned receiver', async () => {
  assert.equal((await verifyZcashTransaction(request, { rpc: rpc() })).independentlyVerified, true);
  assert.equal((await verifyZcashTransaction(request, { rpc: rpc({ getwalletinfo: { scanning: false, enhanced_through: 500, txcount: 1, private_keys_enabled: true, unlocked_until: 0 } }) })).independentlyVerified, true);
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ getblockchaininfo: { chain: 'main', blocks: 500, headers: 500, initialblockdownload: false, bestblockhash: 'c'.repeat(64), time: chainTime } }) }), /not on Zcash testnet/);
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ getblockchaininfo: { chain: 'test', blocks: 500, headers: 500, initialblockdownload: false, bestblockhash: 'c'.repeat(64), time: chainTime - 1_801 } }) }), /tip is stale/);
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ getwalletinfo: { scanning: { progress: 0.9 }, enhanced_through: 400, txcount: 1 } }) }), /incomplete/);
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ getwalletinfo: { scanning: false, enhanced_through: 500, txcount: 1, private_keys_enabled: true, unlocked_until: Math.floor(Date.now() / 1000) + 100 } }) }), /remains locked/);
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ getwalletinfo: { scanning: false, enhanced_through: 500, txcount: 1 } }) }), /watch-only or an encrypted/);
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ getaddressinfo: { ismine: false, isvalid_orchard: true, receiver_types: ['orchard'], diversifier_index: '42' } }) }), /not an owned/);
});

test('rejects outgoing, wrong pool, wrong amount, wrong address identity and non-canonical evidence', async () => {
  const entry = { txid, status: 'mined', confirmations: 12, pool: 'ironwood', category: 'receive', amountZat: 1_000_000, address: receiver, outgoing: false, change: false, blockhash: blockHash, blockheight: 489, diversifier_index: '42' };
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ z_listtransactions: [{ ...entry, outgoing: true, category: 'send' }] }) }), /Exactly one/);
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ z_listtransactions: [{ ...entry, pool: 'orchard' }] }) }), /Exactly one/);
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ z_listtransactions: [{ ...entry, amountZat: 999_999 }] }) }), /Exactly one/);
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ z_listtransactions: [{ ...entry, diversifier_index: '43' }] }) }), /Exactly one/);
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ z_listtransactions: [{ ...entry, outindex: undefined }] }) }), /Exactly one/);
  await assert.rejects(verifyZcashTransaction({ ...request, expectedDiversifierIndex: '43' }, { rpc: rpc() }), /diversifier/);
  await assert.rejects(verifyZcashTransaction({ ...request, minimumConfirmations: 20 }, { rpc: rpc() }), /not sufficiently confirmed/);
  await assert.rejects(verifyZcashTransaction({ ...request, minimumBlockHeight: 490 }, { rpc: rpc() }), /predates this order/);
  await assert.rejects(verifyZcashTransaction({ ...request, minimumBlockTime: 1_900_000_001 }, { rpc: rpc() }), /predates this order/);
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ getblockhash: 'c'.repeat(64) }) }), /not canonical/);
});

test('rejects duplicate matching shielded outputs', async () => {
  const entry = { txid, status: 'mined', confirmations: 12, pool: 'ironwood', category: 'receive', amountZat: 1_000_000, address: receiver, outgoing: false, change: false, blockhash: blockHash, blockheight: 489, diversifier_index: '42', outindex: 0 };
  await assert.rejects(verifyZcashTransaction(request, { rpc: rpc({ z_listtransactions: [entry, { ...entry }] }) }), /Exactly one/);
});

test('read-only live Experiment 03 integration', { skip: process.env.ZCASH_RPC_LIVE !== '1' }, async () => {
  const journal = JSON.parse(await readFile('../../experiments/shielded-receiver/zecd-nu7/zecd-testnet-data/research-send-03.json', 'utf8')) as {
    experiment: string; network: string; amount: string; recipient: string; txid: string; operation_status: string;
  };
  assert.equal(journal.experiment, '03');
  assert.equal(journal.network, 'test');
  assert.equal(journal.operation_status, 'success');
  const result = await verifyZcashTransaction({
    orderId: 'experiment-03-read-only-audit', transactionId: journal.txid, receiver: journal.recipient,
    amountZatoshis: '1000000', requiredPool: 'ironwood', minimumConfirmations: 10,
  });
  assert.equal(result.amount, '0.01');
  assert.equal(result.independentlyVerified, true);
  assert.equal(result.shielded, true);
});
