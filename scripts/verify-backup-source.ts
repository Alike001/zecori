#!/usr/bin/env node
import { createPostgresPool } from '../server/postgres.ts';
import { loadEncryptionKeyring } from '../server/data-encryption.ts';
import { verifyKeyringCanary, type KeyringCanaryRow } from '../server/keyring-canary.ts';

const pool = createPostgresPool();
const encryption = await loadEncryptionKeyring();
try {
  await pool.query('BEGIN TRANSACTION READ ONLY');
  const migrations = await pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
  const expected = ['001_production_foundation','002_settlement_integration','003_private_verification_relay','004_crash_safe_address_allocation','005_passkey_identity','006_staging_keyring_canary','007_owner_destination_binding','008_destination_wallet_control','009_privy_identity'];
  if (migrations.rows.map(row => row.version).join(',') !== expected.join(',')) throw new Error('Source database migration inventory does not exactly match the reviewed 001-009 sequence');
  const canary = await pool.query<KeyringCanaryRow>('SELECT encrypted_canary,encryption_key_version,plaintext_digest FROM staging_keyring_canary WHERE singleton=true');
  verifyKeyringCanary(canary.rows[0], encryption, 'Source');
  await pool.query('COMMIT');
  process.stdout.write(`${JSON.stringify({ status: 'BACKUP_SOURCE_CANARY_VERIFIED', activeVersion: encryption.activeVersion, canaryKeyVersion: canary.rows[0].encryption_key_version })}\n`);
} catch (error) {
  await pool.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally { await pool.end(); }
