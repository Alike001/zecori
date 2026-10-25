import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DataEncryption } from './data-encryption.ts';
import { assertRecoveryInventoryContinuity, createKeyringCanary, prepareKeyringCanary, verifyKeyringCanary } from './keyring-canary.ts';

function encryption(key = randomBytes(32)) {
  return new DataEncryption({ activeVersion: 1, keys: new Map([[1, key]]) });
}

test('source and restored verification fail closed when the canary is missing', () => {
  const crypto = encryption();
  assert.throws(() => verifyKeyringCanary(undefined, crypto, 'Source'), /Source database is missing/);
  assert.throws(() => verifyKeyringCanary(undefined, crypto, 'Restored'), /Restored database is missing/);
});

test('wrong key and corrupted ciphertext cannot satisfy canary continuity', () => {
  const original = encryption();
  const row = createKeyringCanary(original);
  assert.throws(() => verifyKeyringCanary(row, encryption(), 'Restored'), /authentication failed/);
  const corrupted = { ...row, encrypted_canary: Buffer.from(row.encrypted_canary) };
  corrupted.encrypted_canary[corrupted.encrypted_canary.length - 1] ^= 1;
  assert.throws(() => verifyKeyringCanary(corrupted, original, 'Restored'), /authentication failed/);
});

const sharedKey = randomBytes(32);
const encryptionFromRowKey = encryption(sharedKey);

test('a valid encrypted canary decrypts and verifies without exposing its plaintext', () => {
  const row = createKeyringCanary(encryptionFromRowKey);
  assert.doesNotThrow(() => verifyKeyringCanary(row, encryptionFromRowKey, 'Restored'));
});

test('first-time initialization creates once and a valid retry preserves the encrypted canary', () => {
  const crypto = encryption();
  const first = prepareKeyringCanary(undefined, crypto);
  assert.equal(first.created, true);
  const originalEnvelope = Buffer.from(first.row.encrypted_canary);
  const retry = prepareKeyringCanary(first.row, crypto);
  assert.equal(retry.created, false);
  assert.strictEqual(retry.row, first.row);
  assert.deepEqual(retry.row.encrypted_canary, originalEnvelope);
});

test('restart recovery requires identical migration, encrypted-record, audit, and replay inventory', () => {
  const before = { migrations: ['001', '006'], decryptedEnvelopes: 1, encryptedRecords: { canary: 1, orders: 0 }, records: { audit_events: '0', replay_references: '0' } };
  assert.doesNotThrow(() => assertRecoveryInventoryContinuity(before, structuredClone(before)));
  assert.throws(() => assertRecoveryInventoryContinuity(before, { ...before, records: { ...before.records, replay_references: '1' } }), /inventory changed/);
});
