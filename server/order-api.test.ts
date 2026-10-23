import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { BASE_USDC } from '../src/lib/order-coordinator.ts';
import { createOperatorOrderBinding } from '../src/lib/operator-order.ts';
import type { ValidatedReceivingAddress } from './zcash-address-allocator.ts';
import { FileOrderStore, orderApi } from './order-api.ts';

const receiverA = 'utest1completeshieldedreceiver123456789';
const receiverB = 'utest1differentcompletereceiver987654321';
const destination = `0x${'1'.repeat(40)}`;
const sourceTx = 'a'.repeat(64);
const destinationTx = `0x${'b'.repeat(64)}`;

function allocation(address: string, id: string, diversifier: string): ValidatedReceivingAddress {
  return { allocationId: id, address, diversifierIndex: diversifier, validatedAt: '2029-01-01T00:00:00.000Z', sourceNotBeforeHeight: 501, state: 'AVAILABLE' };
}
function input(allocationId: string) {
  return { allocationId, destinationRecipient: destination, sourceAmountZat: '1000000', expiresAt: '2030-01-01T00:00:00.000Z' };
}
function sourceEvidence(request: { orderId: string; transactionId: string; receiver: string; expectedDiversifierIndex?: string }, confirmations = 10) {
  return { orderId: request.orderId, transactionId: request.transactionId, network: 'zcash-testnet' as const, receiver: request.receiver, amount: '0.01', amountZatoshis: '1000000', pool: 'ironwood' as const, status: 'mined' as const, confirmations, blockHeight: 510, blockHash: 'c'.repeat(64), blockTime: Date.parse('2029-01-01T00:01:00.000Z') / 1000, outputIndex: 0, diversifierIndex: request.expectedDiversifierIndex!, shielded: true as const, independentlyVerified: true as const };
}

test('linked workflow is durable, replay-safe, manually authorized and privately completed', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-orders-'));
  const file = join(folder, 'orders.json');
  const store = new FileOrderStore(file);
  const allocationId = await store.reserveReceivingAddress(receiverA, async () => allocation(receiverA, 'allocation-a', '42'));
  const created = await store.create('owner-a', input(allocationId));
  assert.equal(created.status, 'CREATED');
  assert.equal(created.sourceReceiver, '[redacted]');
  assert.equal(created.destinationRecipient, '[redacted]');
  assert.equal('allocationId' in created, false);
  assert.equal('sourceDiversifierIndex' in created, false);
  await store.activate('owner-a', created.id, Date.parse('2029-01-01T00:01:00.000Z'));
  const detected = await store.observeSource('owner-a', created.id, sourceTx, async request => sourceEvidence(request, 2), Date.parse('2029-01-01T00:02:00.000Z'));
  assert.equal(detected.status, 'SOURCE_DETECTED');
  const confirmed = await store.confirmSource('owner-a', created.id, async request => sourceEvidence(request, 10));
  assert.equal(confirmed.status, 'SOURCE_CONFIRMED');
  await assert.rejects(store.verifyPayout('owner-a', created.id, async () => { throw new Error('must not run'); }), /No approved payout/);
  const awaiting = await store.queuePayout('owner-a', created.id);
  assert.equal(awaiting.status, 'PAYOUT_AWAITING_APPROVAL');
  const approved = await store.approvePayout('owner-a', created.id, { operatorId: 'operator-1', authorizationId: 'authorization-1' });
  assert.equal(approved.payoutAuthorization.state, 'APPROVED');
  assert.equal((await store.approvePayout('owner-a', created.id, { operatorId: 'operator-1', authorizationId: 'authorization-1' })).payoutAuthorization.state, 'APPROVED');
  await assert.rejects(store.approvePayout('owner-a', created.id, { operatorId: 'operator-1', authorizationId: 'authorization-2' }), /not awaiting/);
  const submitted = await store.recordPayout('owner-a', created.id, destinationTx);
  assert.equal(submitted.status, 'PAYOUT_SUBMITTED');
  assert.equal(submitted.payoutAuthorization.state, 'CONSUMED');
  await assert.rejects(store.verifyPayout('owner-a', created.id, async () => { throw new Error('RPC unavailable'); }), /RPC unavailable/);
  assert.equal((await store.list('owner-a'))[0].status, 'PAYOUT_SUBMITTED');
  const completed = await store.verifyPayout('owner-a', created.id, async request => ({
    orderId: request.orderId, transactionId: request.transactionId, chainId: 84532,
    tokenContract: BASE_USDC, recipient: request.recipient, amountAtomic: request.amountAtomic, independentlyVerified: true,
  }));
  assert.equal(completed.status, 'COMPLETED');
  const receipt = await store.getReceipt('owner-a', completed.finalReceiptId!);
  assert.ok(receipt);
  for (const field of ['sourceTransactionId', 'destinationTransactionHash', 'verifiedSourceAmount', 'sourceSettlementTimestamp', 'actualKnownFees', 'orderId', 'sourceChain', 'sourceAsset']) assert.equal(field in receipt!, false);
  assert.equal(await store.getReceipt('owner-b', completed.finalReceiptId!), undefined);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('rejects duplicate allocation, concurrent duplicate orders, replay and preserves state on RPC failure', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-concurrency-'));
  const store = new FileOrderStore(join(folder, 'orders.json'));
  const allocationId = await store.reserveReceivingAddress(receiverA, async () => allocation(receiverA, 'allocation-a', '42'));
  await assert.rejects(store.reserveReceivingAddress(receiverA, async () => allocation(receiverA, 'allocation-b', '42')), /already reserved/);
  const attempts = await Promise.allSettled([store.create('owner-a', input(allocationId)), store.create('owner-b', input(allocationId))]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(item => item.status === 'rejected').length, 1);
  const first = attempts.find(item => item.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof store.create>>>;
  const owner = (await store.list('owner-a')).length ? 'owner-a' : 'owner-b';
  await store.activate(owner, first.value.id, Date.parse('2029-01-01T00:01:00.000Z'));
  await assert.rejects(store.observeSource(owner, first.value.id, sourceTx, async () => { throw new Error('RPC unavailable'); }), /RPC unavailable/);
  assert.equal((await store.list(owner))[0].status, 'AWAITING_PAYMENT');
  await store.observeSource(owner, first.value.id, sourceTx, async request => sourceEvidence(request), Date.parse('2029-01-01T00:02:00.000Z'));

  const allocationId2 = await store.reserveReceivingAddress(receiverB, async () => allocation(receiverB, 'allocation-b', '43'));
  const second = await store.create('owner-c', input(allocationId2));
  await store.activate('owner-c', second.id, Date.parse('2029-01-01T00:01:00.000Z'));
  await assert.rejects(store.observeSource('owner-c', second.id, sourceTx, async request => sourceEvidence(request), Date.parse('2029-01-01T00:02:00.000Z')), /already been consumed/);
});

test('operator manifest binds one receiver and withholds payment instructions until allocation and activation', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-operator-order-'));
  const store = new FileOrderStore(join(folder, 'orders.json')); await store.initialize();
  const now = Date.parse('2029-01-01T00:00:00.000Z');
  const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const binding = createOperatorOrderBinding({ orderId, destinationRecipient: destination, expiresAt: '2029-01-01T01:00:00.000Z', now });
  await assert.rejects(store.prepareOperatorOrder({ ...binding, sourceAmountZat: '999999' } as unknown as typeof binding, 'operator-1', 'a'.repeat(64), now), /fixed testnet route/);
  await store.prepareOperatorOrder(binding, 'operator-1', 'a'.repeat(64), now);
  assert.deepEqual(await store.list('browser-owner'), []);
  await assert.rejects(store.prepareOperatorOrder({ ...binding, orderId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', destinationRecipient: `0x${'2'.repeat(40)}` }, 'operator-1', 'b'.repeat(64), now), /pending or unresolved/);
  const allocationId = await store.bindReceivingAddressToPreparedOrder(orderId, receiverA, async () => allocation(receiverA, 'allocation-a', '42'), now + 1);
  assert.equal(allocationId, 'allocation-a');
  const visible = await store.list('browser-owner');
  assert.equal(visible[0].status, 'CREATED'); assert.equal(visible[0].sourceReceiver, '[redacted]'); assert.equal(visible[0].destinationRecipient, '[redacted]');
  await assert.rejects(store.activateOperatorOrder(orderId, 'operator-2', { checkedAt: new Date(now).toISOString(), confirmedZatoshis: '1010000', requiredZatoshis: '1010000' }, now + 2), /identity/);
  await assert.rejects(store.activateOperatorOrder(orderId, 'operator-1', { checkedAt: new Date(now).toISOString(), confirmedZatoshis: '1000000', requiredZatoshis: '1010000' }, now + 2), /lacks sufficient/);
  const activated = await store.activateOperatorOrder(orderId, 'operator-1', { checkedAt: new Date(now).toISOString(), confirmedZatoshis: '1010000', requiredZatoshis: '1010000' }, now + 2);
  assert.equal(activated.order.status, 'AWAITING_PAYMENT'); assert.equal(activated.receiver, receiverA);
});

test('corrupt persistence fails closed', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-corrupt-'));
  const file = join(folder, 'orders.json');
  await writeFile(file, '{not-json', { mode: 0o600 });
  await assert.rejects(new FileOrderStore(file).list('owner-a'));
});

test('browser API is read-only for order lifecycle and exposes no operator mutation routes', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'zecathon-api-'));
  const store = new FileOrderStore(join(folder, 'orders.json'));
  const middleware = orderApi(store);
  const server = createHttpServer((request, response) => { void middleware(request, response, () => { response.statusCode = 404; response.end('not found'); }); });
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise<void>(resolveClose => server.close(() => resolveClose())));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No HTTP test address');
  const base = `http://127.0.0.1:${address.port}`; const origin = base;
  const create = await fetch(`${base}/api/orders`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(input('attacker-allocation')) });
  assert.equal(create.status, 403);
  const cookie = create.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
  const body = await create.text();
  assert.ok(!body.includes(receiverA)); assert.ok(!body.includes(destination)); assert.ok(!body.includes('attacker-allocation'));
  const ownerList = await (await fetch(`${base}/api/orders`, { headers: { cookie: cookie! } })).text();
  assert.ok(!ownerList.includes(receiverA)); assert.ok(!ownerList.includes(destination)); assert.ok(!ownerList.includes(sourceTx));
  for (const action of ['activate', 'approve-payout', 'record-payout', 'verify-payout', 'reserve-address', 'verify-destination']) {
    const routeResponse: Response = await fetch(`${base}/api/orders/example/${action}`, { method: 'POST', headers: { origin, cookie: cookie!, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(routeResponse.status, action === 'activate' ? 403 : 404);
  }
});

test('Vite refuses private database files through public paths and /@fs/', async t => {
  const dataDirectory = resolve('data'); const fixture = join(dataDirectory, 'orders.security-test.json'); const sentinel = 'PRIVATE_ORDER_SENTINEL_DO_NOT_SERVE';
  await mkdir(dataDirectory, { recursive: true }); await writeFile(fixture, sentinel, { mode: 0o600 });
  t.after(async () => { await unlink(fixture).catch(() => undefined); });
  const vite = await createViteServer({ configFile: resolve('vite.config.ts'), server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'silent' });
  await vite.listen(); t.after(async () => { await vite.close(); });
  const address = vite.httpServer?.address(); if (!address || typeof address === 'string') throw new Error('No Vite test address');
  for (const path of ['/data/orders.security-test.json', `/@fs/${fixture}`]) {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`); const responseBody = await response.text();
    assert.notEqual(response.status, 200); assert.ok(!responseBody.includes(sentinel));
  }
});
