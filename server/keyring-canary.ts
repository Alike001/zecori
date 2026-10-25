import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { DataEncryption } from './data-encryption.ts';

export const STAGING_KEYRING_CANARY_CONTEXT = 'staging:keyring-canary';

export type KeyringCanaryRow = {
  encrypted_canary: Buffer;
  encryption_key_version: number;
  plaintext_digest: Buffer;
};

export function createKeyringCanary(encryption: DataEncryption): KeyringCanaryRow {
  const canary = randomBytes(32).toString('base64url');
  return {
    encrypted_canary: encryption.encrypt({ canary }, STAGING_KEYRING_CANARY_CONTEXT),
    encryption_key_version: encryption.activeVersion,
    plaintext_digest: createHash('sha256').update(canary).digest(),
  };
}

export function prepareKeyringCanary(existing: KeyringCanaryRow | undefined, encryption: DataEncryption): { row: KeyringCanaryRow; created: boolean } {
  if (existing) {
    verifyKeyringCanary(existing, encryption, 'Source');
    return { row: existing, created: false };
  }
  const row = createKeyringCanary(encryption);
  verifyKeyringCanary(row, encryption, 'Source');
  return { row, created: true };
}

export function verifyKeyringCanary(row: KeyringCanaryRow | undefined, encryption: DataEncryption, databaseLabel: 'Source' | 'Restored'): void {
  if (!row) throw new Error(`${databaseLabel} database is missing the keyring continuity canary`);
  if (!Buffer.isBuffer(row.encrypted_canary) || !Buffer.isBuffer(row.plaintext_digest) || row.plaintext_digest.length !== 32) {
    throw new Error(`${databaseLabel} keyring canary record is malformed`);
  }
  if (row.encrypted_canary.length < 8 || row.encrypted_canary.readUInt32BE(4) !== row.encryption_key_version) {
    throw new Error(`${databaseLabel} keyring canary version metadata mismatch`);
  }
  const value = encryption.decrypt<unknown>(row.encrypted_canary, STAGING_KEYRING_CANARY_CONTEXT);
  if (!value || typeof value !== 'object' || typeof (value as { canary?: unknown }).canary !== 'string') {
    throw new Error(`${databaseLabel} keyring canary plaintext is malformed`);
  }
  const digest = createHash('sha256').update((value as { canary: string }).canary).digest();
  if (!digest.equals(row.plaintext_digest)) throw new Error(`${databaseLabel} keyring canary digest mismatch`);
}

export function assertRecoveryInventoryContinuity(before: unknown, after: unknown): void {
  if (!isDeepStrictEqual(before, after)) throw new Error('Restored record inventory changed across PostgreSQL restart.');
}
