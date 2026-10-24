import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DataEncryption } from './data-encryption.ts';

function crypto(version = 1) { return new DataEncryption({ activeVersion: version, keys: new Map([[version, randomBytes(32)]]) }); }

test('private data uses randomized authenticated encryption with bound context', () => {
  const encryption = crypto();
  const first = encryption.encrypt({ receiver: 'utest1private' }, 'order:one');
  const second = encryption.encrypt({ receiver: 'utest1private' }, 'order:one');
  assert.notDeepEqual(first, second);
  assert.deepEqual(encryption.decrypt(first, 'order:one'), { receiver: 'utest1private' });
  assert.throws(() => encryption.decrypt(first, 'order:two'), /authentication failed/);
  const tampered = Buffer.from(first); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => encryption.decrypt(tampered, 'order:one'), /authentication failed/);
});

test('key versions support rotation and fail closed when an old key is absent', () => {
  const oldKey = randomBytes(32); const nextKey = randomBytes(32);
  const old = new DataEncryption({ activeVersion: 1, keys: new Map([[1, oldKey]]) });
  const envelope = old.encrypt({ evidence: true }, 'evidence:test');
  const rotated = new DataEncryption({ activeVersion: 2, keys: new Map([[1, oldKey], [2, nextKey]]) });
  assert.deepEqual(rotated.decrypt(envelope, 'evidence:test'), { evidence: true });
  assert.throws(() => new DataEncryption({ activeVersion: 2, keys: new Map([[2, nextKey]]) }).decrypt(envelope, 'evidence:test'), /version 1 is unavailable/);
});
