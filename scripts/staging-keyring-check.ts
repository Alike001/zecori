#!/usr/bin/env node
import { createPostgresPool } from '../server/postgres.ts';
import { loadEncryptionKeyring } from '../server/data-encryption.ts';
import { prepareKeyringCanary, verifyKeyringCanary, type KeyringCanaryRow } from '../server/keyring-canary.ts';

const pool = createPostgresPool(); const encryption = await loadEncryptionKeyring();
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('LOCK TABLE staging_keyring_canary IN EXCLUSIVE MODE');
  const existing = await client.query<KeyringCanaryRow>('SELECT encrypted_canary,encryption_key_version,plaintext_digest FROM staging_keyring_canary WHERE singleton=true');
  const canary = prepareKeyringCanary(existing.rows[0], encryption);
  if (canary.created) {
    await client.query(`INSERT INTO staging_keyring_canary(singleton,encrypted_canary,encryption_key_version,plaintext_digest)
      VALUES(true,$1,$2,$3)`, [canary.row.encrypted_canary, canary.row.encryption_key_version, canary.row.plaintext_digest]);
  }
  const row = (await client.query<KeyringCanaryRow>('SELECT encrypted_canary,encryption_key_version,plaintext_digest FROM staging_keyring_canary WHERE singleton=true')).rows[0];
  verifyKeyringCanary(row, encryption, 'Source');
  await client.query('UPDATE staging_keyring_canary SET verified_at=now() WHERE singleton=true');
  await client.query('COMMIT');
  process.stdout.write(`${JSON.stringify({ status: 'STAGING_KEYRING_VERIFIED', activeVersion: encryption.activeVersion, created: canary.created })}\n`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally { client.release(); await pool.end(); }
