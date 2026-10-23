import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOperatorConfig, loadOperatorConfig, validateOperatorAddresses } from './operator-config.ts';
import { FileOrderStore } from './order-api.ts';
import { inspectOperatorKey, OperatorControlStore } from './operator-control.ts';

const lp = `0x${'1'.repeat(40)}`;
const receiver = `0x${'2'.repeat(40)}`;

test('validates distinct complete Base account addresses', () => {
  validateOperatorAddresses(lp, receiver);
  assert.throws(() => validateOperatorAddresses('0x1234', receiver), /full/);
  assert.throws(() => validateOperatorAddresses(lp, lp.toUpperCase().replace('0X', '0x')), /different/);
});

test('creates private configuration, stores network confirmation, and never overwrites it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zecathon-config-'));
  const path = join(root, 'private', 'operator-config.json');
  await createOperatorConfig({ lpSender: lp, usdcReceiver: receiver, now: 1_900_000_000_000 }, path);
  const config = await loadOperatorConfig(path);
  assert.equal(config.chainId, 84532);
  assert.equal(config.confirmationSource, 'interactive-metamask');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, 'private'))).mode & 0o777, 0o700);
  await assert.rejects(createOperatorConfig({ lpSender: receiver, usdcReceiver: lp }, path), /EEXIST/);
  assert.equal((JSON.parse(await readFile(path, 'utf8')) as { lpSender: string }).lpSender, lp);
});

test('initializes empty private stores and provisions a non-printable random HMAC key without overwrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zecathon-bootstrap-'));
  const folder = join(root, 'private');
  const orderPath = join(folder, 'orders.json');
  const controlPath = join(folder, 'operator-control.json');
  const keyPath = join(folder, 'operator.key');
  const orders = new FileOrderStore(orderPath);
  const controls = new OperatorControlStore(controlPath, keyPath);
  await orders.initialize();
  await controls.initialize();
  await controls.provisionKey();
  assert.deepEqual(await orders.operatorSnapshot(), { orders: [], allocationCounts: { available: 0, assigned: 0 }, replayReferenceCount: 0 });
  assert.deepEqual(await controls.inspect(), { authorizations: [], allocations: [] });
  assert.deepEqual(await inspectOperatorKey(keyPath), { ready: true });
  assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
  const originalKey = await readFile(keyPath);
  await assert.rejects(controls.provisionKey(), /EEXIST/);
  assert.deepEqual(await readFile(keyPath), originalKey);
});
